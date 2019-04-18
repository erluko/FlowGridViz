#!/usr/bin/env node

const fs = require('fs');
const crypto = require('crypto');
const request = require('request');

function usage(){
  console.log(`
USAGE:
apitool.js keyid:path/to/key check BASE_URL
apitool.js keyid:path/to/key reload URL
apitool.js keyid:path/to/key update URL JSON
apitool.js keyid:path/to/key delete URL
`);
  process.exit(1);
}

if(process.argv.length<5 ||
   process.argv[2] == '-h' ||
   process.argv[2] == '--help' ){
  usage();
}

let [keyid,keyfilepath] = process.argv[2].split(':');
let action = process.argv[3];

if(action == 'update' && process.argv.length<6){
  usage();
}

let url = process.argv[4]
if(url.endsWith("/")) url = url.substr(0,url.length-1)

var key = fs.readFileSync(keyfilepath, 'ascii');

const urlsig = {
  key: key,
  keyId: keyid,
  headers: ['date','(request-target)']
}

const bodysig = {
  key: key,
  keyId: keyid,
  headers: ['date','digest','(request-target)']
}

let acts={
  check:  (x)=> request.post(url+'/auth_check',{httpSignature: urlsig},x),
  reload: (x)=> request.post(url+'/reload',{httpSignature: urlsig},x),
  delete: (x)=> request.delete(url,{httpSignature: urlsig},x),
  update: (x)=> {
    let d=process.argv[5];
    return request.put(url,{body:d,
                            httpSignature: bodysig,
                            headers:{digest:"SHA-256="+crypto.createHash('sha256').update(d).digest('base64')}},x)}
};

let act = acts[action];
if(act){
  let httpStream = act(function (error, response, body) {
    console.log('error:', error); // Print the error if one occurred
    console.log('statusCode:', response && response.statusCode); // Print the response status code if a response was received
    console.log('body:', body); // Print the body
  });
} else {
  usage();
}
