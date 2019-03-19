const http = require('http');
const express = require('express');
const app = express();
const jsdom = require("jsdom");
const { JSDOM } = jsdom;
const LRU = require("lru-cache")
const me = require('./lib/matrixexplorer');

const slist = require('./js/servicelist.js');
const phr = require('./js/porthasher.js');
let ph = new phr.porthasher({portmap: slist.servicemap,
                             only:false});
let packets = null;
let matrix = null;

LRU.prototype.getOrSet = function(k,f){
  let v = this.get(k);
  if(typeof v === 'undefined'){
    v = f();
    this.set(k,v);
  }
  return v;
}


app.engine('html',require('./lib/jsdt')({cache: new LRU(30)}));
app.set('view engine', 'html');


const port = 3000;
const ip = '127.17.96.39';

app.get('/', (req, res) => res.send('Hello World!'))
app.get('/matrix/*', function(req, res){
  let ps = req.params['0'];
  let pp = me.pathParser(ps);
  res.render('matrix',{
    key: pp,
    render: function(window,sdone) {
      let doc = window.document;
      let t = doc.createTextNode(packets?JSON.stringify(pp)+"\n"+packets.length:"No Packets Yet");
      doc.getElementsByTagName("body")[0].appendChild(t);
    }
  });
});

let mwcache = new LRU(80);

let mwalk = function(pth){
  if(typeof ph === 'undefined'
     || typeof matrix === 'undefined'){
    return [];
  }
  bcount = 256
  let sports = new Set(matrix.sports);
  let spmax = matrix.sports[matrix.sports.length-1];
  let dports = new Set(matrix.dports);
  let dpmax = matrix.dports[matrix.dports.length-1];

  let lph = ph;
  let mwk = [];
  for(let [[xt,yt],idx] of pth) {
    //ignoring xt and yt for now. Treating both as 'p'
    if(idx != null){
      mwk.push(idx);
      [sports,dports,lph] = mwcache
        .getOrSet(JSON.stringify(mwk), function(){
          let x = idx % bcount;
          let y = Math.floor(idx / bcount);
          let sps = lph.backhash(y,spmax).filter(p=>sports.has(p));
          let dps = lph.backhash(x,dpmax).filter(p=>dports.has(p));
          return [new Set(sps),
                  new Set(dps),
                  new phr.porthasher({portlist: sps.concat(dps),
                                      only: true})]
        });
      spmax = undefined;
      dpmax = undefined;
    }
  }
  return me.getMatrix(lph,packets.filter(r=>sports.has(r[2]) &&
                                         dports.has(r[3])));
}


/* sed mimicry */

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

app.get('/js/:script.js',function (req,res){
  res.sendFile(req.params['script']+'.js',{root:'js'});
});
app.get('/out/:script.js',function (req,res){
  res.sendFile(req.params['script']+'.js',{root:'out'});
});
app.get('*/index.html',function(req,res){
  //todo: consider moving index.html to './static/'
  res.sendFile('views/index.html',{root:'.'});
});
app.get('*/matrix.json',function(req,res){
  let ps = req.params['0'];
  let pp = me.pathParser(ps);
  let lmat = mwalk(pp);
  res.json(lmat);
});
app.get('*/pmatrix.js',function(req,res){
  let ps = req.params['0'];
  let pp = me.pathParser(ps);
  let lmat = mwalk(pp);
  res.send(jsonWrap('pmatrix',lmat));
});
app.get('/pcap.json',(req,res)=>res.json(packets));


console.log("Reading pcap data");
(require('./lib/pcsd')
  .fromFile('data/pcap.txt')
  .then(function(p){
    packets = p;
    matrix = me.getMatrix(ph,packets);
    var server = http.createServer(app);
    server.on("error", e =>console.log(`Unable to start server: ${e}`));
    server.listen(port, ip, () => console.log(`Packet capture visualization app listening on http://${ip}:${port}!`));
  }));

