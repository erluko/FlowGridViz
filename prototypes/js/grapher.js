(function(){
    var inNode = !(typeof Window === 'function' &&
                 Window.prototype.isPrototypeOf(this));

  var root = inNode?module.exports:this;
  let importData = inNode?n=>require('../out/'+n+'.js').IMPORT_DATA.get(n):n=>IMPORT_DATA.get(n);

  let slist = inNode?require('servicelist.js'):{servicemap: root.servicemap};
  let phr = inNode?require('porthasher.js'):{porthasher: root.porthasher};
  let ph = new phr.porthasher({portmap: slist.servicemap,
                               only:false});

  let bcount = 256;
  pdata = importData('pmatrix');
  let sports = new Set(pdata.sports);
  let spmax = pdata.sports[pdata.sports.length-1];
  let dports = new Set(pdata.dports);
  let dpmax = pdata.dports[pdata.dports.length-1];
  let plotrix = pdata.matrix;

  // first watch for any existing load events
  let oldload = null;
  if(window.onload){
    oldload=window.onload;
  }

  function callxy(f){
    return {x:f("x"),y:f("y")}
  }

  //here's the setup: try to play nice with exisiting onLoads, if any
  window.onload = function(){
    if(typeof(oldload) == 'function'){
      oldload.apply(this,arguments);
    }

    let WIDTH = 600;
    let HEIGHT = 600;

    var SIZES = {x:WIDTH, y:HEIGHT};

    let svg = d3.select("body")
        .append("svg")
        .attr("width",WIDTH)
        .attr("height",HEIGHT);


    // distinct paddings -- to leave room for title, labels, and legend
    let PADDINGS = {left: 0,
                    right: 0,
                    top: 0,
                    bottom: 0}

    // pre-calculating common padding operations
    PADDINGS.x = PADDINGS.left + PADDINGS.right;
    PADDINGS.y = PADDINGS.top + PADDINGS.bottom;
    PADDINGS.a = {x: PADDINGS.left, y: PADDINGS.top};
    PADDINGS.b = {x: PADDINGS.right, y: PADDINGS.bottom};

    let squareSideMax = callxy(xy=>(SIZES[xy]-PADDINGS[xy])/
                               (bcount+1));

    let squareSide = Math.min(squareSideMax.x,squareSideMax.y);

    let scales = callxy(xy => d3.scaleLinear()
                        .domain([0,bcount+1])
                        .range([PADDINGS.a[xy],
                                squareSide * (bcount+1)
                                + PADDINGS.a[xy]]));
    let UNIT_SIZE = {
      x: scales.x(1)-scales.x(0), //~=squareSide
      y: scales.y(1)-scales.y(0)  //~=squareSide
    };




    scales.z = d3.scaleLog()
      .domain([1,d3.max(plotrix)])
      .range([0,1]);

    let gapf = 1;//0.03;
    let rf = 1;//0.08;

    /* todo: consider defining subgraphs as a series of triples:
      (i|p,i|p,idx) instead of sources and destingations
      this takes us from:
         /subgraph?sports=1110,1366,...&dports=1177,1433,...
      to:
         /pp54/pi234/ip3423/ii743
      which says to first get idx=54 in a port/port matrix, then
      idx=234 in the resulting port/ip matrix, then idx=2423 in
      an ip/port view of that result, then finally to render the 743rd
      element of an ip/ip view of that matrix.

      What axes should be used for the last one? Not sure. Maybe use
      the pi|pp|ip|ii pairs as a final dir entry?
         e.g. /pp/54/pi/234/ip/3423/ii/743/pp to view the last
         matrix as a port/port view by default?
    */
    let showSubgraph = function([sps,dps]){
      console.log('subgraph?sports='+sps.join(',')+'&dports='+dps.join(','));
    }

    let showSubgraphI = function(idx){
      let newpath='./'+idx+'/pp/index.html'
      if(window.location.pathname.startsWith('/index.html')){
        newpath = 'pp/'+newpath;
      }
      window.location.href=newpath;
    }

    //todo: allow for src/dest to each be either ip or  port
    let portsForIndex = function(idx){
      let x = idx % bcount;
      let y = Math.floor(idx / bcount);
      let sps = ph.backhash(y,spmax).filter(p=>sports.has(p));
      let dps = ph.backhash(x,dpmax).filter(p=>dports.has(p));
      return [sps,dps];
    }

    let tip = d3.tip()
        .attr('class', 'port-tip')
        .html(function([c,idx]){
          if(c>0){
            let [sps,dps] = portsForIndex(idx);
            return "count: "+c+"<br/>from: "+sps.join(' ')+
              "<br/>to: "+dps.join(' ');
          } else {
            return "";
          }
        });

    svg.call(tip)
    function handleHover(mode,datum,index,nodes){
      if(mode){
        if(datum>0){
          tip.show([datum,index])
            .style("pointer-events","")//get from css
            .style("opacity","");//get from css
        }
      } else {
        tip.hide();
      }
    }

    svg.selectAll("rect.plot")
      .data(plotrix)
      .enter()
      .append("rect")
      .classed("plot",true)
      .attr("width",UNIT_SIZE.x*(gapf))
      .attr("height",UNIT_SIZE.y*(gapf))
      .attr("x",(d,i)=>scales.x(Math.floor(i / bcount))+UNIT_SIZE.x*(gapf/2))
      .attr("y",(d,i)=>scales.y(i % bcount)+UNIT_SIZE.y*(gapf/2))
      .attr("fill",d=>d==0?'white':d3.interpolateYlOrBr(scales.z(d)))
      .on("mouseover",function(){handleHover.call(this,true,...arguments)})
      .on("mouseout",function(){handleHover.call(this,false,...arguments)})
      .on("click", (count,idx) => showSubgraphI(idx))
  //      .on("click", (count,idx) => showSubgraph(portsForIndex(idx)))
    };
  })();
