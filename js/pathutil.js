 /* Subgraphs are defined as a series of triples: (i|p,i|p,idx)
    expressed as a path: /(i|p)(ip)/idx/...
    e.g.  /pp/54/pi/234/ip/3423/ii/743
    which says to first get idx=54 in a port/port matrix, then
    idx=234 in the resulting port/ip matrix, then idx=2423 in
    an ip/port view of that result, then finally to render the 743rd
    element of an ip/ip view of that matrix.

    What axes should be used for the last one? See the last path
    element. If it is a number, the axes will be port/port. If it
    is one of the pi|pp|ip|ii pairs, the axes expressed will be used.
 */
(function(){
  var inNode = !(typeof Window === 'function' &&
                 Window.prototype.isPrototypeOf(this));

  var root = inNode?module.exports:(this.pathutil={});

  root.pathParser = function (s){
    let instr = s.split('/');
    while(!/^[pi]{2}$/.test(instr[0])) instr.shift();
    if(!/^(?:[pi]{2}|\d+)$/.test(instr[instr.length-1])) instr.pop();
    instr=instr.filter(g => g.length > 0)
        .map((p,i)=>i%2?
             (/^\d+$/.test(p)?+p:null):
             (/^[pi]{2}$/.test(p)?Array.from(p):null));
    return instr.includes(null)?[]:(instr.length%2?instr.concat(null):instr).reduce(
      (a,b,i)=>((i%2?a[0]=[a[0],b]:a.unshift(b)),a),[]).reverse();
  }
  root.isTopLevel = function(pathParts){
    return pathParts == null ||
      pathParts.length == 0 ||
      pathParts[0].length<2 ||
      pathParts[0][1] == null;
  }
})()
