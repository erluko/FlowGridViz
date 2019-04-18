#!/usr/bin/env python
import requests
from requests_http_signature import HTTPSignatureAuth
import sys
import warnings
from cryptography.utils import CryptographyDeprecationWarning
warnings.filterwarnings('ignore', category=CryptographyDeprecationWarning)


def usage():
  print('''USAGE:
apitool.js keyid:path/to/key check BASE_URL
apitool.js keyid:path/to/key reload URL
apitool.js keyid:path/to/key update URL JSON
apitool.js keyid:path/to/key delete URL
  ''');
  exit(1)


if len(sys.argv)<4 or sys.argv[1] == '-h' or sys.argv[1] == '--help':
  usage()


(keyid,keyfilepath) = sys.argv[1].split(':');
action = sys.argv[2];

if action == 'update' and len(sys.argv)<5 :
  usage()

url = sys.argv[3]
if url.endswith("/"):
  url = url[:-1]

with open(keyfilepath, 'rb') as fh:
  auth=HTTPSignatureAuth(algorithm="rsa-sha256",
                         key=fh.read(),
                         key_id=keyid)
  res = {'content': "No request sent"}
  if action == 'reload':
    res = requests.post(url+'/reload', auth=auth)
  if action == 'update':
    res=requests.put(url, data=(sys.argv[4]).encode('ascii'), auth=auth)
  if action == 'delete':
    res=requests.delete(url, auth=auth)
  if action == 'check':
    res=requests.post(url+'/auth_check', auth=auth)
  print(res.content)