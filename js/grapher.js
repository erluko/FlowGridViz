/* Uses D3 to render the flowgridviz UI */
(function(){
    var inNode = !(typeof Window === 'function' &&
                 Window.prototype.isPrototypeOf(this));

  var root = inNode?module.exports:this;
  let importData = inNode?n=>require('../out/'+n+'.js').IMPORT_DATA.get(n):n=>IMPORT_DATA.get(n);

  // See js/onecookie.js for more info:
  let defsettings = {anim:true,shrt:false};
  let settings = OneCookie.get(defsettings);
  Object.entries(defsettings).forEach(
    function([dk,dv]) {
      if(!(dk in settings)){
        settings[dk]=dv;
      }
    });

  // Build an empty watcher array for each setting
  let settingsWatchers = Object.entries(settings).reduce((a,[k,v])=>(a[k]=[],a),{});

  // find out about the selected input
  let inp = importData('input') || ['',{},'/'];
  let input_key = inp[0];
  let input_rec = inp[1];
  let input_home = inp[2];

  // check for data source readiness
  let status = (importData('status') || {status: 'failed'})['status'];
  if(status == 'loading'){
    window.onload=function(){
      // Show a loading screen if the data is not ready yet, poll every second
      let body = d3.select("body");
      body.selectAll('*').remove();
      let s="Loading data. Please wait.";
      document.title=s;
      let h1=body.append("H1").text(s);
      window.setTimeout(_=>window.location=window.location,1000);
      return;
    }
    return;
  } else if (status == 'failed') {
    window.onload=function(){
      // Show a failure screen if the data won't ever be ready
      let body = d3.select("body");
      body.style('background','white')
      body.selectAll('*').remove();
      let s="This input failed to load. Please return to the input list.";
      document.title=s;
      body.append("H1")
        .append('a')
        .attr('href',input_home)
        .text(s);
    }
    return;
  }
  /* pmatrix is a jsonWrapped structure representing the matrix.
     See server.js for more details. */
  pdata = importData('pmatrix');

  let sources = new Set(pdata.sources); // list of source ports or IPs
  let dests = new Set(pdata.dests);     // list of dest ports or IPs
  let plotrix = pdata.matrix;           // heatmap sparse matrix
  let labels = importData('labels');    // list of labels
  let type_labels = {p: 'Port',i: "IP"};// for axis labels
  let type_display = {p: x=>x, // display ports as-is
                      // convert IPs to dotted notation
                      i: x=> ((x >>> 24 & 0x0FF)+'.'+
                              (x >>> 16 & 0x0FF)+'.'+
                              (x >>>  8 & 0x0FF)+'.'+
                              (x >>>  0 & 0x0FF))};

  let uilabels = ["None"].concat(labels)
  let labelOpacitySettings = uilabels.map(()=>0);

  // get the nethasher code
  let phr = inNode?require('nethasher.js'):{nethasher: root.nethasher};
  let bcount = phr.nethasher.getBucketCount();

  // construct a nethasher equivalent to the one used to generate this matrix
  let ph = new phr.nethasher(pdata.hashconfig);

  // first watch for any existing load events
  let oldload = null;
  if(window.onload){
    oldload=window.onload;
  }

  // cross-browser helper for finding the size of things
  function getSize(sel,name,def){
    try{
      s = +sel.node().getBoundingClientRect()[name];
    } catch(e){}
    if(isNaN(s)){
      s = +sel.attr("name").replace(/px/,'');
    }
    if(isNaN(s)){
      s = +sel.style("name").replace(/px/,'');
    }
    if(isNaN(s)){
      s = def;
    }
    return s;
  }

  // call a function once with "x" and a gain with "y", store results in a map
  function callxy(f){
    return {x:f("x"),y:f("y")}
  }

  /*
    makeVertical is to be called with selection.call() on a text
    node THAT DOES NOT HAVE x OR y SET
   */
  function makeVertical(s,x=0,y=0){
    let fx = typeof x == 'function'?x:(_=> x);
    let fy = typeof y == 'function'?y:(_=> y);

    return s
      .attr("style","writing-mode: tb")
      .attr("transform", (d,i) => "matrix(-1 0 0 -1 "
            + fx(d,i)
            + " "
            + fy(d,i)
            +")");
  }

  //here's the setup: try to play nice with exisiting onLoads, if any
  window.onload = function(){
    if(typeof(oldload) == 'function'){
      oldload.apply(this,arguments);
    }

    // parse the path in order to build the nav UI
    let pathParts = pathutil.pathParser(window.location.pathname
                                        .substring(0,window.location.pathname.length-"index.html".length));
    let top_level = pathutil.isTopLevel(pathParts);

    // start by prepending the input key to make it possible to return to root
    let chunks = ["inputs",input_key,].concat(pathParts.reduce((o,p)=>o.concat(p),[]))
    let numparts = chunks.length - (chunks[chunks.length-1]==null?2:1);
    let dots = Array.from({length:numparts},x=>'../'); // make a lot of dots

    let body = d3.select("body");

    let showLoading = function(){
      // cause the backround image (see main.css) to appear
      svg.style("opacity",0);
      body.style("background-image",null);
    }

    let hideLoading = function(){
      // hide the background image (see main.css)
      svg.style("opacity",1);
      body.style("background-image","none");
    }

    // If the input has a name, use it in the title and heading
    if(input_rec.title){
      let titleDetail =document.createTextNode(input_rec.title);
      let colon = document.createTextNode(": ");
      if(input_rec.ref){
        // if the input references another site, link to it
        let text = titleDetail;
        titleDetail = document.createElement("a");
        titleDetail.setAttribute("href",input_rec.ref);
        titleDetail.setAttribute("target","_blank");
        titleDetail.appendChild(text);
      }
      let h1=body.select("h1").node();
      h1.appendChild(colon);
      h1.appendChild(titleDetail);
      document.title=h1.innerText;
    }

    // build the navigation interface
    body.select("div.nav")
      .selectAll("span.uplink")
      .data(chunks)
      .enter()
      .append("span")
      .classed("uplink",true)
      .text(" / ")
      .append("a")
      .attr("href",function(d,i,a) {
        if(i==1){
          return null;
        } else if(i==0){
          return dots.slice(i+i%2).join('');
        } else if(numparts-i>1){
          return dots.slice(i+i%2).join('')+'index.html';
        }
        return null;
      })
      .each(function(){if(this.href) d3.select(this).on("click",showLoading)})
      .text(v=>v instanceof Array?v.join(''):v)

    // build the view interface (selecting source/dest view types)
    let sel = pdata.stype+pdata.dtype;
    body.select("div.types")
      .selectAll("a.type")
      .data("pp pi ip ii".split(" "))
      .enter()
      .append("a")
      .attr("href",d=>'../'+d+'/index.html')
      .attr("class",d=>d+"_link")
      .classed("types_selected",d=>d==sel)
      .on("click",showLoading)
      .text(d=>d)

    let svgHolder = body.select("div.graph");

    // ask the renderer for how big the SVG-holding div really is
    let svgHolderWidth = getSize(svgHolder,"width", 700)

    let WIDTH = svgHolderWidth - 8
    let HEIGHT = WIDTH;

    var SIZES = {x:WIDTH, y:HEIGHT};

    let svg = svgHolder.append("svg")
        .attr("width",WIDTH)
        .attr("height",HEIGHT)
//todo: FIXME
    svg.node().setAttribute("xmlns:xlink","http://www.w3.org/1999/xlink");

    // Establish a clip-path to make the labeled rect strokes appear inset
    svg.append("defs")
      .append("clipPath")
      .attr("clipPathUnits","objectBoundingBox")
      .attr("id","cpth")
      .append("rect")
      .attr("width","1")
      .attr("height","1")

    // distinct paddings -- to leave room for title, labels, etc.
    let PADDINGS = {left: 40,
                    right: 0,
                    top: 0,
                    bottom: 30}

    // pre-calculating common padding operations
    PADDINGS.x = PADDINGS.left + PADDINGS.right;
    PADDINGS.y = PADDINGS.top + PADDINGS.bottom;
    PADDINGS.a = {x: PADDINGS.left, y: PADDINGS.top};
    PADDINGS.b = {x: PADDINGS.right, y: PADDINGS.bottom};


    // Make Y (source) axis
    svg.append("g")
      .classed("y-axis-label",true)
      .append("text")
      .call(makeVertical,PADDINGS.left-8,HEIGHT/2)
      .text("Source "+type_labels[pdata.stype])

    // Make X (dest) axis
    svg.append("g")
      .classed("x-axis-label",true)
      .append("text")
      .attr("x",WIDTH/2)
      .attr("y",HEIGHT-PADDINGS.bottom+8)
      .text("Destination "+type_labels[pdata.dtype])

    // Calculate maximum rect dimensions
    let squareSideMax = callxy(xy=>(SIZES[xy]-PADDINGS[xy])/
                               (bcount+1));

    // Make a square using the smaller of the max dimensions
    let squareSide = Math.min(squareSideMax.x,squareSideMax.y);

    // Positioning scale for rect placement
    let scales = callxy(xy => d3.scaleLinear()
                        .domain([0,bcount+1])
                        .range([PADDINGS.a[xy],
                                squareSide * (bcount+1)
                                + PADDINGS.a[xy]]));
    // opacity scale for label sliders
    scales.op = d3.scaleLinear()
      .domain([-10,0])
      .range([0,1])
      .clamp(true);

    let UNIT_SIZE = {
      x: scales.x(1)-scales.x(0), //~=squareSide
      y: scales.y(1)-scales.y(0)  //~=squareSide
    };

    //FIXME: this still says packets, should say records
    let totalPackets = 0;
    let maxCount = 0;
    let usedL = 0;
    plotrix.forEach(function ([i,[v,l]]) {
      usedL = usedL | l;
      maxCount = Math.max(maxCount,v);
      totalPackets += v;
    });

    // make a color scale based on the number of records represented by the square
    scales.z = d3.scaleLog()
      .domain([1,maxCount])
      .range([0.15,1]);

    let gapf = 1;

    /* Subgraphs are described in lib/matrixexplorer.js

       The implementation here takes the current path and links
       "index.html" in a virtual subdirectory whose relative
       "pmatrix.js" will contain the specfic matrix information for
       the selected index.
     */
    let subgraphURL = function(idx){
      let newpath='./'+idx+'/'+pdata.stype+pdata.dtype+'/index.html'
      return newpath;
    }

    /* Given an index, return the sources and dests that might have contributed
       to it */
    let valuesForIndex = function(idx){
      let x = idx % bcount;
      let y = Math.floor(idx / bcount);
      let sps = ph.backhash(y,sources);
      let dps = ph.backhash(x,dests);
      return [sps,dps];
    }

    // Build filter UI
    let tsharkfilter = body.select(".tsharkfilter");
    let tsa = tsharkfilter.append("a")
        .attr("href","#tfilter")
        .text("Show filter");

    let tfilter = tsharkfilter.append("div")
        .classed("tfilter", true)
        .attr("id","tfilter")
        .classed("hidden", true);

    // Show or hide the tshark filter text
    function toggleFilter(){
      let showNow = tfilter.classed("hidden");
      if(tfilter.text() == ''){
        tfilter.text(top_level?'tcp or udp':filtermaker.tsDisplayFilter(
          pdata.sources.map(type_display[pdata.stype]),
          pdata.dests.map(type_display[pdata.dtype]),
          pdata.stype,pdata.dtype));
      }
      tsa.text(showNow?"Hide filter":"Show filter");
      tfilter.classed("hidden",!showNow);
    }
    tsa.on("click",toggleFilter)

    // The box on the right was once a tooltip, the word tip still appears here
    let tipHolder = body.select("div.port-tip")
        .style("height",scales.y(bcount)+"px")
        .style("position","absolute")
        .style("top",getSize(svgHolder,"top", 50)+"px")
        .style("left",getSize(svgHolder,"right", svgHolderWidth)+"px")

    // Center the loading graphic and the page heading
    body.style("width",getSize(tipHolder,"right", svgHolderWidth)+"px");
    body.style("background-position", (svgHolderWidth/2)+"px center");

    // Object for holding the "lines" of the tip text
    let tip = {count: tipHolder.append("span"),
               label: labels.length>0?(tipHolder.append("br"),tipHolder.append("span")):{text:_=>null},
               source: (tipHolder.append("br"),tipHolder.append("span")),
               dest: (tipHolder.append("br"),tipHolder.append("span")),
              }

    // If abbreviation is enable, use elipses for too-long text
    function elideText(text,max){
      return text.length > max?text.substr(0,max-1)+'\u2026':text;
    }

    // update tip fields with the totals
    function showTotals(){
      let shorten = settings.shrt;
      tip.count.text("Total Count: "+totalPackets)
      let fromtext = pdata.sources.map(type_display[pdata.stype]).join(' ');
      if(shorten) fromtext = elideText(fromtext,1000);
      tip.source.text("from: "+ fromtext);
      let totext = pdata.dests.map(type_display[pdata.dtype]).join(' ');
      if(shorten) totext = elideText(totext,1000);
      tip.dest.text("to: " + totext);
      tip.label.text("label(s): "+(usedL==0?'None':labels.filter((n,i)=>usedL & 1<<i)));
    }

    // If the abbreviation feature flag changes, call showTotals()
    settingsWatchers.shrt.push(showTotals);

    function handleHover(mode,[idx,[c,l]],index,nodes){
      if(mode){
        // MouseOver: update tip fields based on hover

        let [sps,dps] = valuesForIndex(+idx);
        tip.count.text("count: "+c)
        tip.source.text("from: "+sps.map(type_display[pdata.stype]).join(' '));
        tip.dest.text("to: "+dps.map(type_display[pdata.dtype]).join(' '));
        tip.label.text("label(s): "+(l==0?'None':labels.filter((n,i)=>l & 1<<i)));
      } else {
        // MouseOut: show the totals again
        showTotals()
      }
    }

    // Start with totals rendered
    showTotals();

    // Build the heatmap
    let as = svg.selectAll("a.plot")
        .data(plotrix);

    // next line not needed unless changing node counts
    as.exit().remove();

    // Each node is an anchor tag
    let newAs=as.enter()
        .append("a")
        .classed("plot",true)

    // Each anchor contains a rect
    newAs.append("rect")
        .classed("plot",true);

    /* If there are multiple points, each anchor has an href linking
       to that point's subgraph */
    let allAs = as.merge(newAs);
    if(plotrix.length>1){
      allAs.attr("xlink:href",([idx,v]) => subgraphURL(+idx))
        .on("click",function(){
          // animate "zooming in" to the point if animation is enabled
          if(settings.anim){
            let anchor = d3.select(this);
            d3.event.preventDefault()
            let crect = d3.select(svg.node()
                                  .appendChild(anchor.select("rect")
                                               .node()
                                               .cloneNode()));
            let recs = d3.selectAll('rect.plot')
                .transition()
                .style("opacity",0);

            crect.style('clip-path','none')
              .style("opacity",0.1)
              .transition()
              .attr("width",WIDTH-PADDINGS.x)
              .attr("height",HEIGHT-PADDINGS.y)
              .attr('x',scales.x(0))
              .attr('y',scales.y(0))
              .style("opacity",1)
              .on("end",_=>{window.location=anchor.attr("href");
                            showLoading()});
          } else {
            // if not animating, at least provide the loading feedback
            showLoading();
          }
        });
    }
    let allRects = allAs.select("rect");

    function opacityForLabelVs(lvs){
      return scales.op(d3.mean(lvs));
    }

    allRects.attr("width",UNIT_SIZE.x*(gapf))
      .attr("height",UNIT_SIZE.y*(gapf))
      .attr("x",([idx,[v,l]])=>scales.x((+idx) % bcount)+UNIT_SIZE.x*(gapf/2))
      .attr("y",([idx,[v,l]])=>scales.y(Math.floor((+idx) / bcount))+UNIT_SIZE.y*(gapf/2))
      .attr("fill",([idx,[v,l]])=>v=0?'white':d3.interpolateYlOrBr(scales.z(v)))
      .classed("labeled",([idx,[v,l]])=>l!=0) // highlight labeled points
      .style("opacity",([idx,[v,l]])=>opacityForLabelVs(
        labelOpacitySettings.filter(
          (_,li)=>(l==0 && li==0) || ((l<<1) & (1<<li)))))
      .on("mouseover",function(){handleHover.call(this,true,...arguments)})
      .on("mouseout",function(){handleHover.call(this,false,...arguments)})

    // set up the label appearance UI
    let labeler = body.select('#labeler');
    let labelerbox = body.select('#labeler-panel');
    if(labels.length > 0){
      let uiusedL = (usedL << 1) | 1; //"None" is always enabled
      let labelopts = labelerbox.append("form")
          .selectAll("label.labeler-opt")
          .data(uilabels)
          .enter()
          .append("label")
          .classed("labeler-opt",true)
          .classed("enabled-label",(d,i)=>uiusedL & 1<<i)
      labelopts.append('input')
        .classed("label-slider",true)
        .attr("type","range")
        .attr("min","-10")
        .attr("max",(d,i)=>i==0?"0":"10")
        .attr("value",(d,i)=>labelOpacitySettings[i])
        .attr("id",d=>d)
        .on("input",function(d,i){
          labelOpacitySettings[i] = +this.value;
          allRects.each(function(){
            let rect=d3.select(this);
            let [idx,[c,l]]=rect.datum();
            //Only affect rects whose label opacity was modified
            if((l==0 && i==0) || ((l<<1) & (1<<i))){
               rect.style("opacity",opacityForLabelVs(
                 labelOpacitySettings.filter(
                   (_,li)=>(l==0 && li==0) || ((l<<1) & (1<<li)))))
            }
          })
        })

      labelopts.append(d=>document.createTextNode(d));

      labeler.classed("hidden",false);
      labeler.on("click", function(){
        if(labelerbox.style("visibility") == "visible"){
          win.on("click.labeler",null);
          labelerbox.style("visibility","hidden")
        } else {
          labelerbox.style("visibility","visible")
          win.on("click.labeler", windowHideLabeler);
        }
      })
    }

    // set up the settings panel/gear UI
    let setbox = body.select('#settings-panel');
    let gear = body.select('#gear');

    let options = setbox.append("form")
        .selectAll("label.setting")
        .data([{name:"Use Animations",cname:"anim"},
               {name:"Abbreviate Long Lists",cname:"shrt"},])
        .enter()
        .append("label")
        .classed("setting",true)

    // Put the checkboxes in place with "checked" based on cookie
    options.append("input")
      .attr("type","checkbox")
      .attr("checked",d=>settings[d.cname]?"checked":null)
      .on("change",function(){
        let me = d3.select(this);
        let d = me.datum();
        settings[d.cname]=this.checked;
        settingsWatchers[d.cname].forEach(x=>x(this.checked));
        OneCookie.set(settings);
      })

    // Set each option's label
    options.append(d=>document.createTextNode(d.name));

    // Position the box
    setbox.style("left",((getSize(gear,"right") - getSize(setbox,"width"))+"px"))
      .style("top",getSize(gear,"bottom")+"px");

    labelerbox.style("left",((getSize(labeler,"right") -
                           getSize(labelerbox,"width"))+"px"))
      .style("top",getSize(labeler,"bottom")+"px");

    // Make it so that any click outside of the visible settings box hides it
    let win = d3.select(window);
    let windowHideSettings = function(){
      if(d3.event.target!=gear.node() &&
         !setbox.node().contains(d3.event.target)){
        gear.dispatch("click")
      }
    }
    let windowHideLabeler = function(){
      if(d3.event.target!=labeler.node() &&
         !labelerbox.node().contains(d3.event.target)){
        labeler.dispatch("click")
      }
    }

    // Clicking the gear toggles showing the settings box
    gear.on("click",
            function(){
              if(setbox.style("visibility") == "visible"){
                win.on("click.settings",null);
                setbox.style("visibility","hidden")
              } else {
                setbox.style("visibility","visible")
                win.on("click.settings", windowHideSettings);
              }
            })
    //remove loading graphic
    hideLoading();
  };
})();
