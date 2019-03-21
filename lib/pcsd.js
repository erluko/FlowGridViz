var readline = require('readline');
var fs = require('fs');
const zlib = require('zlib');

function ipStrToInt(s){
  // ">>>0" thanks to http://2ality.com/2012/02/js-integers.html
  let octets = s.split('.');
  return (octets[0]<<24 | octets[1] <<16 | octets[2]<<8 |octets[3] )>>>0;
}


module.exports.fromFile = function(fname){
  return new Promise(function(resolve,reject){
    let rows;
    let ridx = 0;
    try {
      //estimate 39 bytes per row
      //preallocation was faster in testing
      rows = new Array(Math.ceil(fs.statSync(fname).size/39));
    } catch (e){
      return reject(e)
    }

    //gzip reading from:
    // https://stackoverflow.com/questions/38074288/read-gzip-stream-line-by-line
    var rs = fs.createReadStream(fname);
    var rl = readline.createInterface({
      input: fname.endsWith('.gz')?rs.pipe(zlib.createGunzip()):rs
    });

    rl.on('line', function(line){
      //147.32.84.180 86.126.40.27   1063 3128
      let idx = 0;
      let space = false;
      let row = new Array(4).fill('');
      for(c of line){
        if(c == ' '){
          if(!space){
            space = true;
            idx++;
          }
        } else {
          space = false;
          row[idx]+=c;
        }
      }
      row[0] = ipStrToInt(row[0]);
      row[1] = ipStrToInt(row[1]);
      row[2] = +row[2];
      row[3] = +row[3];
      rows[ridx++] = row;
    }).on('close',_=>{rows.length=ridx; // truncate if overallocated
                      resolve(rows)})
  })};
