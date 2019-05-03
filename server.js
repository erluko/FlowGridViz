// npm modules
const fs = require('fs');
const http = require('http');
const express = require('express');
const app = express();
const jsdom = require("jsdom");
const { JSDOM } = jsdom;
const LRU = require("lru-cache")
const httpSignature = require('http-signature');
const bodyParser = require('body-parser');
const crypto = require('crypto');

/*
  verifyInstanceDigest is a body-parser verifier that checks that if a
  Digest: header was provided, the digest is using an allowed
  algorithm and the digest matches the request body.
*/
const DIGEST_RE =new RegExp("^SHA-?(256|512)?=(.*)$",'i'); //sha,sha-256,sha-512
function verifyInstanceDigest(req, res, buf, encoding) {
  let dhead=req.headers['digest'];
  if(!dhead) {
    throw new Error("HTTP Instance Digest requried but not provided")
  }
  let alg_match=DIGEST_RE.exec(dhead);
  if(alg_match){
    let expected = crypto.createHash('sha'+(alg_match[1]||'')).update(buf).digest('base64');
    let received = alg_match[2];
    if((''+expected) == (''+received)){
      return true;
    }
    throw new Error("HTTP Instance Digest mismatch")
  } else {
    throw new Error("Unrecognized Instance Digest algorithm");
  }
}

// allow jsonParser to ignore content-type header, make it enforce RFC3230/5843 digest
var jsonParser = bodyParser.json({type: _=>true,
                                  verify: verifyInstanceDigest})


// local modules
const me = require('./lib/matrixexplorer');
const pu = require('./js/pathutil');
const tsf = require('./js/filtermaker');
const slist = require('./lib/servicelist.js');
const phr = require('./js/nethasher.js');


// Routine to verify that an input record (via API or inputs.json) is well-formed
let allowedInputKeys = new Set(['file','url','initial','title','no_label','ref']);
function verifyInputFormat(input){
  return (input != null &&
          typeof(input) == 'object' &&
          Object.keys(input).every(k=>allowedInputKeys.has(k)) &&
          ((input.file ==null) ^ (input.url == null)));
  // Only one of "file" or "url" can be specified
}


/* ph0 is the default un-configured hasher to use for the initial top-level
   views where no axis shows ports */
let ph0 = new phr.nethasher();

/* ph0_servs is a hasher configured to know about common service
   ports. It is used for top-level views where at least one axis shows ports. */
let ph0_servs = new phr.nethasher(slist.servicemap);


function Dataset(key,input){
  this.input = input;
  this.key = key;
  this.labels  = []; // per-dataset list of labels
  this.records = []; // per-dataset list of flows or packets
  this.status = {};// per-dataset object showing loading status
}

Dataset.prototype = {
  updateStatus: function (attr,val) {
    this.status[attr]=val;
  }
};

let datasets = new Map();

// dynamic urls all start with this prefix:
let dyn_root = 'viz/';

// every LRU and Map should have a get-or-set method
LRU.prototype.getOrSet = Map.prototype.getOrSet = function(k,f){
  let v = this.get(k);
  if(typeof v === 'undefined'){
    v = f();
    this.set(k,v);
  }
  return v;
}

// returns k in map, or def if not present
Map.prototype.getOr = function(k,def){
  let v = this.get(k);
  if(typeof v === 'undefined'){
    return def
  }
  return v;
}

/* load the Javascript DOM Template library I created for this project,
   give it a 30-element LRU cache,
   and set it as the template engine to use for html.*/
// TODO: make the LRU size configurable
app.engine('html',require('./lib/jsdt')({cache: new LRU(30)}));
app.set('view engine', 'html');

// configured port should the server listen on?
const port = process.env.npm_package_config_port;

// configured IP address to listen on
const ip = process.env.npm_package_config_listen_ip;

// configured directory storing authorized key files for API caller authentication
const key_dir = process.env.npm_package_config_key_dir;

// configured *per-dataset* upper limit on records to load
const max_records = (s=>s?(s.toLowerCase()=='all'?0:+s||0):0)(process.env.npm_package_config_max_records);

// base for all urls, usually "fgv" in production
let url_root = process.env.npm_package_config_url_root || '/';
if(!url_root.endsWith("/")) url_root=url_root+'/';
if(!url_root.startsWith("/")) url_root='/'+url_root;

// a simple exception type to use
function NotReadyException(thing) {
  this.thing = thing;
}

// cache to hold 80 different matrix walks
// TODO: make the size configurable
let mwcache = new LRU(80);

// Port x Port, Port x IP, IP x Port, IP x IP
let legalViews=new Set(['pp','pi','ip','ii']);

/* Each dataset can set a default view.
   If none is specified, start with Port x Port */
let defaultView = function(rname){
  let inp = datasets.getOr(rname,{}).input;
  let view = (inp?inp.initial:null);
  return legalViews.has(view)?view:'pp';
}

/* Originally "porthasher walker", now the "ph" is just an artifact of
   the days before flowgridviz supported flows and IPs.

   TODO: rename phwalk

   Given a dataset name and a path string to walk, performs the walk.
   See MatrixExplorer for more details */
let phwalk = function(rname,pth){
  // Use selected path or the default if none is specified
  if(pth == null || pth.length <1){
    pth = pu.pathParser('/'+defaultView(rname)+'/');
  }
  //Apply the service list only at top level and only if showing ports
  //on at least one axis:
  let lph = (pth[0][0][0]=='p' ||
             pth[0][0][1]=='p')?ph0_servs:ph0;

  // pkts is the list of records to consider in this walk
  let pkts = datasets.getOr(rname,{}).records;
  if(!pkts){
    /* this only happens if someone requests a url that depends
       on the records for a nonexistent or not-yet-loaded dataset.
       One common cause would be a server restart. */
    throw new NotReadyException(rname);
  }
  let bcount = phr.nethasher.getBucketCount();

  // mwk ("matrix walk" is used as the cache key, it starts with the dataset name)
  let mwk = [rname];

  let matrix;
  for(let [[stype,dtype],idx] of pth) {
    //stype and dtype are either 'p' meaning port of 'i' meaning ip
    //idx is the coordinate of the cell to enter (y*bcount+x)
    matrix = me.getMatrix(lph,stype,dtype,pkts)
    let sources = new Set(matrix.sources);
    let dests = new Set(matrix.dests);
    /* idxs is the list of indices into the columns of each record
       that represent the requested data.
       The native storage is src-ip, dest-ip, src-port, dst-port, ...
       So for view 'pp' idxs = [2,3]
       and for view 'ip' idxs = [0,3]
       See matrixexplorer.js
    */
    let idxs = me.idxsForTypes(stype,dtype);
    if(idx != null){
      // extend the cache key
      mwk.push(''+stype+dtype+idx);
      // either read from cache or caclulate the next answer
      [sources,dests,lph] = mwcache
        .getOrSet(JSON.stringify(mwk), function(){
          let x = idx % bcount;
          let y = Math.floor(idx / bcount);
          let sps = lph.backhash(y,sources);
          let dps = lph.backhash(x,dests);
          return [new Set(sps),
                  new Set(dps),
                  new phr.nethasher(sps.concat(dps).map((v,i)=>[v,i]))];
        });
      // keep on the records left after walking into the matrix
      pkts = pkts.filter(r=>sources.has(r[idxs[0]]) &&
                         dests.has(r[idxs[1]]));

    }
  }
  /* return the newly calculated (or fetched from cache) matrix,
     and the list of packets or flows it represents */
  return [matrix,pkts];
};


// Matrix Walk, it's just a helper around a common use of phwalk
let mwalk = function(rname,pth){
  let [matrix,pkts] = phwalk(rname,pth);
  return matrix;
}


/* This function is essentially sed mimicry.
   Early versions of the code used 'sed' at install-time to convert
   json files into javascript files loadable via a script tag, essentially
   a safer form of jsonp. For the few bits of code that depended on this,
   we have jsonWrap() which duplicates the old sed script behavior.
 */
function jsonWrap(n,d){
  let j = JSON.stringify(d);
  return `(function(){
  var inNode = !(typeof Window === 'function' &&
                 Window.prototype.isPrototypeOf(this));
  var root = inNode?module.exports:this;

  if(typeof root.IMPORT_DATA === 'undefined'){
    root.IMPORT_DATA = new Map();
  }
  // NOTE: this section is filled in by sed.
  let data = [
    ${j}
  ]; //end data
  if(data.length == 1) {
    data = data[0];
  }
  root.IMPORT_DATA.set('${n}',data);
})();
`;
}


// reroot() Prepends the base address to absolute paths in the DOM
function reroot(rname,attr){
   return function(n){
     let s=n.getAttribute(attr);
     if(s.startsWith("/")){
       s = s.substr(1);
       if(s.lastIndexOf("/")<1){
         s = dyn_root+rname +"/"+s;
       }
       n.setAttribute(attr,url_root+s)
     }
   }
}

// Define some basic routes to redirect to the "starting" page.
app.get(url_root+dyn_root,(req,res) => res.redirect(url_root+'inputs.html'));
app.get(url_root,(req,res) => res.redirect(url_root+'inputs.html'));
app.get(url_root+'index.html',(req,res) => res.redirect(url_root+'inputs.html'));

// The favicon route intentionally does not use url_root, it is only used if url_root == '/'
app.get('/favicon.ico',function (req,res){
  //thanks to http://transparent-favicon.info/favicon.ico
  res.sendFile('favicon.ico',{root:'images'});
});

// Handle all static file paths. Express handles rejecting path traversal attacks.
app.get(url_root+'images/:imagefile',function (req,res){
  //thanks to http://www.ajaxload.info/
  res.sendFile(req.params['imagefile'],{root:'images'});
});
app.get(url_root+'style/:cssfile',function (req,res){
  res.sendFile(req.params['cssfile'],{root:'style'});
});
app.get(url_root+'js/:script.js',function (req,res){
  res.sendFile(req.params['script']+'.js',{root:'js'});
});
app.get(url_root+'js-ext/:script.js',function (req,res){
  res.sendFile(req.params['script']+'.js',{root:'js-ext'});
});

let homeurl=url_root+'inputs.html';
// route for actually generating responses to requests for inputs.html
app.get(homeurl,function(req,res){
  res.render('inputs',{
    render: function(window,sdone) {
      /* given a DOM-like structure, modify it to represent the intended
         output DOM. Why not use the built-in express templates? They are
         vulnerable to XSS. This is not. */
      let document = window.document;
      if(!anyInputLoading()){
        /* when all sources have been processed, we can ditch the script
           tag that polls for loading state */
        document.getElementById("readyscript").remove()
      }
      // Generate <img> and <a> tags for each data source
      let holder = document.getElementById("sources");
      for(dataset of datasets.values()){
        /* prevent path weirdness in data source names. */
        if(dataset.key.indexOf('/') == -1){
          let img = document.createElement("img");
          let status = (dataset.status || {status: 'failed'})['status'];
          img.setAttribute("src", status=='ready'?"images/checkbox.png":
                           status=='failed'?"images/redx.png":
                           "images/loading-sm.gif");
          holder.appendChild(img);
          let a = document.createElement("a");
          if (status != 'failed'){
            /* the "readyscript" polls for readiness of all href-having
               anchor tags, don't provide an href for known-bad sources */
            a.setAttribute("href",dyn_root + dataset.key+"/");
          }
          a.appendChild(document.createTextNode(dataset.input.title));
          holder.appendChild(a);
          holder.appendChild(document.createElement("br"));
        } else {
          console.log("Bad data source name");
        }
      }
      // fix absolute urls be re-rooting them:
      Array.from(document.getElementsByTagName("script")).forEach(reroot('',"src"));
      Array.from(document.getElementsByTagName("link")).forEach(reroot('',"href"));
    }});
});

function forceValidRedirect(pp,req,res){
  //FIXME: this whole function is a hack to fix bad urls
  if(pu.isValidFinalPath(pp)){
    return false;
  }
  pp = pu.makeValidFinalPath(pp);
  let l=Object.entries(req.params).reduce((a,[k,v])=>a+v.length+1,dyn_root.length);
  let fname = req.path.substr(l);
  newpath = url_root+req.params['input']+"/"+pu.toPathStr(pp)+fname;
  res.redirect(newpath);
  return true;
}


/* When visiting a data-source with no 'pp', 'ip', etc., go to the default view
   for that data source. */
app.get(url_root+dyn_root+':input/',function(req,res){
  let rname = req.params['input'];
  res.redirect(url_root+dyn_root+rname+'/'+defaultView(rname)+'/index.html');
});
app.get(url_root+dyn_root+':input/index.html',function(req,res){
  let rname = req.params['input'];
  res.redirect(url_root+dyn_root+rname+'/'+defaultView(rname)+'/index.html');
});

// Render the matrix view for the selected input and path
app.get(url_root+dyn_root+':input/*/index.html',function(req,res){
  let rname = req.params['input']; // the data source name
  let ps = req.params['0']; // the matrix path
  let pp = pu.pathParser(ps); // the parsed matrix path
  if(forceValidRedirect(pp,req,res)) return; // fix bad urls (hack)
  res.render('index',{
    // 'index' above tells the viewer to fetch view/index.html
    // the value of key: below is used as the cache key in the view layer
    key: rname+'/index',
    render: function(window,sdone) {
      let document = window.document;
      // fix all absolure urls in the document:
      Array.from(document.getElementsByTagName("img")).forEach(reroot(rname,"src"));
      Array.from(document.getElementsByTagName("script")).forEach(reroot(rname,"src"));
      Array.from(document.getElementsByTagName("link")).forEach(reroot(rname,"href"));
    }});
});

/* API Route to list data set labels. Not used internally */
app.get(url_root+dyn_root+':input/labels.json',function(req,res){
  let rname = req.params['input'];
  let ls = datasets.getOr(rname,{}).labels;
  res.json(ls);
});

// This route makes the labels for the selected data set available in-browser
app.get(url_root+dyn_root+':input/labels.js',function(req,res){
  let rname = req.params['input'];
  let ls = datasets.getOr(rname,{}).labels;
  res.type("text/javascript");
  res.send(jsonWrap("labels",ls));
});

/* API Route to get data set definition. Not used internally */
app.get(url_root+dyn_root+':input/input.json',function(req,res){
  let rname = req.params['input'];
  let inp= datasets.getOr(rname,{}).input;
  res.json([rname,inp,homeurl]);
});

/* This route makes the input definition for the selected data set
   available in-browser */
app.get(url_root+dyn_root+':input/input.js',function(req,res){
  let rname = req.params['input'];
  let inp = datasets.getOr(rname,{}).input;
  res.type("text/javascript");
  res.send(jsonWrap("input",[rname,inp,homeurl]));
});

/* API Route to get matrix for given matrix path. Not used internally */
app.get(url_root+dyn_root+':input/*/matrix.json',function(req,res){
  let rname = req.params['input'];
  let ps = req.params['0'];
  let pp = pu.pathParser(ps);
  if(forceValidRedirect(pp,req,res)) return;
  try{
    let lmat = mwalk(rname,pp);
    res.json(lmat);
  } catch(e) {
    if(e instanceof NotReadyException){
      res.status(409).json({error: "Resource not ready, try again later"})
    } else {
      throw e;
    }
  }
});

/* This route is makes the matrix for the seleted data set and matrix path
   available in-browser. */
app.get(url_root+dyn_root+':input/*/pmatrix.js',function(req,res){
  let rname = req.params['input'];
  let ps = req.params['0'];
  let pp = pu.pathParser(ps);
  if(forceValidRedirect(pp,req,res)) return;
  try{
    let lmat = mwalk(rname,pp);
    res.type("text/javascript");
    res.send(jsonWrap('pmatrix',lmat));
  } catch(e) {
    if(e instanceof NotReadyException){
      res.status(409).type("text/javascript").send(jsonWrap("pmatrix",{error: "Resource not ready, try again later"}));
    } else {
      throw e;
    }
  }
});


/* API Authentication function

   req: the request
   required_headers: an array of strings containing the header names that were
     expected to have been signed.

   Returns an object that contains details of the verification process.
   the .verified element of that object should be checked: it's set to true IFF
   the signature was valid and covered all the required headers.

   This is used to authenticate the API request. Authorization is
   implied by the presence of a known key. Future changes may create
   per-api permissions, in which case an authorization function will
   be needed in addition to this authentication function.
*/
function verifyRequestAuthenticity(req,required_headers = []){
  // Extract the signature data
  let parsed = httpSignature.parseRequest(req);
  /* TODO: check that parsed throws no errors rather than letting the
     default error handler show the user a stack trace */

  // Get the key ID and convert it into a slash-free filename
  let key_file = parsed.keyId.replace("/","_");
  let pubkeydata = (function(){
    try{
      // attempt to read the public key
      return fs.readFileSync(key_dir+'/'+key_file+'.pem', 'ascii');
    } catch (e) {
      return null;
    }
  })();

  /* Populate "info" with a failed state so if we fall through to the return,
     the system fails closed */
  let info = { passed_signature: false,
               passed: false,
               key_id: parsed.keyId,
               request_headers: parsed.params.headers,
               required_headers: required_headers
             };
  if(pubkeydata != null){
    // If the public key was loaded, check the signature against it
    info.passed_signature = httpSignature.verifySignature(parsed, pubkeydata);

    // Check that the signature coveres the required parts of the request
    info.passed = info.passed_signature &&
      required_headers.every(h=>info.request_headers.includes(h))
  }
  return info;
}

// Generate a message explaining why authentication failed
function failedAuthMessage(info){
  return "Signature authentication with a known public key is required over "+
    "at least (" + JSON.stringify(info.required_headers) + ").\n" +
    "See: https://tools.ietf.org/html/draft-cavage-http-signatures-10"
}

// Start loading an input definition, including storing it in the input map
function loadInput(dataset,proms) {
  datasets.set(dataset.key,dataset);
  dataset.status={status:"loading",start:new Date().getTime()};
  let input = dataset.input;

  console.log(`Started loading input "${dataset.key}"`);
  console.log(input);

  let prom = null;
  if(input.file){
    if(input.file.indexOf("/") >=0 ){
      // reject files that have path traversal characters
      recordLoadFailure(key,"Illegal input file name")
    } else {
      // get a promise for the parsed data
      prom = FlowParser.flowsFromFile('data/'+input.file,{max: max_records,
                                                          no_label: input.no_label});
    }
  } else if(input.url) {
    prom = FlowParser.flowsFromURL(input.url,{max: max_records,
                                              no_label: input.no_label});
  } // there's no "else" here because the following null check handles that case
  if(prom != null) {
    /* Without this rather annoying catch(_=>{}), the error which is handled
       just fine in the 'failure' function bubbles up again in Promise.all(...).
       When Promise.protoype.finally() is added to the standard, this won't be
       necessary. */
    if(proms) {
      proms.push(prom.catch(_=>{}));
    }
    // Either store the sucessfully loaded data or record that the load failed
    prom.then(acceptLoadedInput.bind(null,dataset),
              recordLoadFailure.bind(null,dataset));
  }
  //above use of bind inspired by:
  // https://stackoverflow.com/questions/32912459/promises-pass-additional-parameters-to-then-chain
}

// Authenticate API to remove a data set
app.delete(url_root+dyn_root+':input',function(req,res){
  let rname = req.params['input'];
  // Ensure the API request is authentic
  let verif = verifyRequestAuthenticity(req, ['date','(request-target)'])
  if(!verif.passed){
    res.status(401).type("text/plain").send(failedAuthMessage(verif));
  } else {
    let oldInput = datasets.getOr(rname,{}).input;
    // get rid of the old data, cache, etc.
    clearLoadedInput(rname);

    // Send back whatever the old definition was
    res.json(oldInput);
  }
});

// Authenticated API to add, replace, or reload a data set
app.put(url_root+dyn_root+':input',jsonParser,function(req,res){
  let rname = req.params['input'];
  // Ensure the API request is authentic (including the body digest):
  let verif = verifyRequestAuthenticity(req, ['date','digest','(request-target)'])
  if(!verif.passed) {
    res.status(401).type("text/plain").send(failedAuthMessage(verif));
  } else {
    let update = req.body;
    //TODO: Consider using an empty body as a synonym or replacement for "reload"
    if(verifyInputFormat(update)){
      // get rid of the old data, cache, etc.
      clearLoadedInput(rname);

      // populate the data
      loadInput(new Dataset(rname,update));

      //TODO: consider sending the status URL instead
      // send the new data back
      res.json(update);
    } else {
      res.status(400).type("text/plain").send("Invalid input specification")
    }
  }
});

// Authentication check API. See README.
app.post(url_root+'auth_check',function(req,res){
  // Perform the verification check, but do not enforce it
  let verif = verifyRequestAuthenticity(req)
  // Let the caller see the result of the check
  res.json(verif)
});

// Authenticated API used for forcing the reload of a named data source
app.post(url_root+dyn_root+':input/reload/',function(req,res){
  // Ensure the API request is authentic:
  let verif = verifyRequestAuthenticity(req, ['date','(request-target)'])
  if(!verif.passed) {
    res.status(401).type("text/plain").send(failedAuthMessage(verif));
  }  else {
    let rname = req.params['input'];
    let input = datasets.getOr(rname,{}).input;
    // get rid of the old data, cache, etc.
    clearLoadedInput(rname);

    // populate the data
    loadInput(new Dataset(rname, input));

    // TODO: consider redirecting to ready.json instead
    // send the requester home
    res.redirect(homeurl)
  }
});


/* Used for polling loading status of a data set
   USED INTERNALLY BY grapher.js */
app.get(url_root+dyn_root+':input/status.js',function(req,res){
  let rname = req.params['input'];
  res.type("text/javascript").send(jsonWrap('status',datasets.getOr(rname,{}).status));
});

/* API Route for examining loading status of a data set.
   USED INTERNALLY BY inputsloading.js via AJAX*/
app.get(url_root+dyn_root+':input/status.json',function(req,res){
  let rname = req.params['input'];
  res.json(datasets.getOr(rname,{}).status);
});

/* API Route to list tshark filter rules for the given matrix path
   within the data set.

   Potentially useful for building applications that fetch filter rules
   for particular matrix paths.

   Not used internally */
app.get(url_root+dyn_root+':input/*/filter.txt',function(req,res){
  let rname = req.params['input'];
  let ps = req.params['0'];
  let pp = pu.pathParser(ps);
  if(forceValidRedirect(pp,req,res)) return;
  try {
    let matrix = mwalk(rname,pp);
    res.type("text/plain")
    res.send(tsf.tsDisplayFilter(matrix.sources,
                                 matrix.dests,
                                 matrix.stype,
                                 matrix.dtype)+"\n");
  } catch(e) {
    if(e instanceof NotReadyException){
      res.status(409).type("text/plain").send("error: Resource not ready, try again later");
    } else {
      throw e;
    }
  }
});
// API Route as described above, but for the default (no-path) rule
app.get(url_root+dyn_root+':input/filter.txt',function(req,res){
  res.type("text/plain")
  res.send("tcp or udp\n");
});

/* API Route to list flow or packet records for the data set.
   Not used internally */
app.get(url_root+dyn_root+':input/records.json',function(req,res){
  let rname = req.params['input'];
  let recs = datasets.getOr(rname,{}).records;
  if(recs){
    res.json(recs);
  } else {
    res.status(409).json({error: "Resource not ready, try again later"})
  }
});

/* API Route to list flow or packet records for the given matrix path
   within the data set.  Not used internally */
app.get(url_root+dyn_root+':input/*/records.json',function(req,res){
  let rname = req.params['input'];
  let ps = req.params['0'];
  let pp = pu.pathParser(ps);
  if(forceValidRedirect(pp,req,res)) return;
  try {
    let [matrix,pkts] = phwalk(rname,pp);
    res.json(pkts);
  } catch(e) {
    if(e instanceof NotReadyException){
      res.status(409).json({error: "Resource not ready, try again later"})
    } else {
      throw e;
    }
  }
});


// Returns true if any of the known inputs are in the "loading" state
function anyInputLoading(){
  return Array.from(datasets.values()).some(v=>v.status.status=="loading");
}

// "main" code that executes when 'npm start' is run begins here.
console.log("Reading records");
let dots = setInterval(function(){
  /* TODO: consider managing this timer so that it is disabled after initial
     loading and re-enabled by API interaction */
  if(anyInputLoading()){
    console.log(".");
  }
}, 5000);

// TODO: move require() calls to the top
const FlowParser = require('./lib/flowparser');

// Remove all traces of one of the inputs. It doesn't have to be "loaded"
function  clearLoadedInput(key){
  // delete the labels, records, and status for the dataset
  datasets.delete(key);

  /* remove its cache entries
     IMPORTANT: this is needed for when (if) the data set is ever re-added
     Since the "reload" logic first removes and then re-adds a data-set,
     this is absolutely essential to ensuring that the user will see the new
     data rather than the old data.
  */
  mwcache.forEach(function(_,ckey,c){
    let ck=JSON.parse(ckey);
    if(ck.length && ck[0]==key) {
      c.del(ckey);
    }
  })
}


// mark the input status as "failed" so we can surface this in the UI
function  recordLoadFailure(dataset,why){
  console.log(dataset.input);
  dataset.updateStatus('status',"failed");
  dataset.updateStatus('error',why);
  dataset.updateStatus('done',new Date().getTime());
  console.log(`Failed to load "${dataset.key}": ${why}`);
}

/* New data and labels have arrived for an input.
   Assiciate them with the input and mark it as ready. */
function  acceptLoadedInput(dataset,[p,l]){
  console.log(dataset.input);
  dataset.updateStatus('done',new Date().getTime());
  dataset.updateStatus('record_count',p.length)
  dataset.labels = l;
  dataset.records = p;
  dataset.updateStatus('status',"ready");
  let status = dataset.status;
  let elapsedSecs = ((status.done - status.start)/1000).toFixed(3);
  console.log(`Loaded ${status.record_count} records in ${elapsedSecs} seconds for "${dataset.key}"`);
}

// TODO: get rid of "proms" and use the statuses array instead
// List of promises to track:
let proms = [];

// load list of input datasources
let inputs_r = new Map(JSON.parse(fs.readFileSync("./data/inputs.json")));
for(let [key,input] of inputs_r){
  if(verifyInputFormat(input)){
    loadInput(new Dataset(key, input), proms)
  } else {
    console.log(`Rejecting malformed input "${key}"`)
  }
}

// Log that all startup inputs have finished
Promise.all(proms).then(function(){
  console.log('All startup inputs loaded');
})

//Start the server at the selected IP and port
var server = http.createServer(app);
server.on("error", e =>console.log(`Unable to start server: ${e}`));
server.listen(port, ip, () => console.log(`flowgridviz listening on http://${ip}:${port}${url_root}!`));
