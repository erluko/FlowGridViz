Interactive Packet Capture Visualization
========================================

This is web-based packet capture or net flow explorer.  It maps the
sources and destinations of tcp and udp traffic onto a 53x53 grid.
Sources and destinations are either port numbers or IP addresses. Each
grid point represents the intersection of source and destination. The
darkness of each point is based on the number of such pairs present in
the input data.

The hashing function used to make the initial reduction down to the
coordinate space is intentionally reversible so that the list of
actually observed ports or IPs for a point can be calculated after the
fact without having to store a complete bidirectional mapping.

When examining the totality of the traffic, the system applies its
awareness of special ports that are part of the same protocol (e.g. 20
and 21 for ftp, 80 and 8080 for http)* and hashes them to the same
value. When investigating a subset of traffic, the list of applicable
ports is intended to spread for best visual separation.

For any given graph point, mousing over will reveal details of the
traffic that *might* have led to that point being illuminated and
clicking will cause the graph to redraw, including only elements that
*actually* caused that point to illuminate.

[*]: Not as currently implemented. This will be configurable.

Input Data
==========

The file `data/inputs.json` describes the list of available inputs. It
is read from disk at startup time. It is a JSON array that contains
one element per input source. Each input source is an array containing
two elements, a key and an object. The objects must carry values for
`title` and either `file` or `url`:

    ["dataset_name", {file: "file-name", title: "title-text"}]

The `dataset_name` is a short string that must not contain slashes. It will
represent this dataset in URLs generated by pcapviz. The `file-name`
is relative to the `data/` directory. The `title-text` is a string
that will be displayed to the user as the name of this data source.

Other fields include:

 * url: the http or https url from which to fetch the data
        NOTE: `url` is mutually exclusive with `file`. Pick one.
 * no_label: flows with this label will be treated as unlabeled
 * ref: The url of a web page describing the data source (not a link
   to a pcap)
 * initial: one of: 'pp','ip','pi','ii' to indicate the default view
   for this data set. Defaults to port x port view (pp).

Each input file is read and processed at startup time. pcapviz can
read gzipped input data and this is highly recommended.

Additional inputs can be added while pcapbiz is running by using the
APIs described later in this document.

Each input file must be of the format:

    source_ip,dest_ip,source_port,dest_port[,weight,label,identifier]

If not specified, the weight defaults to 1 and both the label and the
identifier default to the empty string. The weight is used as a
multiplier when constructing the visualization matrix. The labels are
used to highlight particular cells in the matrix, and the identifier
is an arbitrary string of your choice, useful for referencing
particular packets or flows in the source data.

For packet captures, the appropriate format can be generated using
`util/convert-pcap.js` as follows:

    util/convert-pcap.sh /path/to/file.pcap | \
      gzip -c > data/my-pcap.gz

To convert fewer packets, try:

    util/convert-pcap.sh /path/to/file.pcap -c NUM_PACKETS | \
      gzip -c > data/my-pcap.gz

For network flows, the output of `pcaplabel` or `cicflowmeter` can be
used. The output of either of these tools can be converted to the
appropriate format using `util/convert-flows.js` as follows:

    util/convert-flows.js /path/to/file.gz | \
      gzip -c > data/my-flows.gz

The `convert-flows.js` utility defaults to setting the weight of each
flow to the value of `Tot Fwd Pkts`.

Sample content for `inputs.json` and a sample labeled flow file are
present in the `input/` directory. The default install will copy these
files into the `data/` directory. Please edit the `data/inputs.json` file
to point at the correct data sources.


Unauthenticated APIs
====================

pcapviz supports a few GET endpoints for extracting information about
the system state or the data sets. These read-only APIs do not require
authentication. These APIs are unversioned and subject to change.

All URLs in the API definitions below are rooted in the base URL
defined by the port and url_root defined in the configuration. Assume
your pcapviz installation is at `https://site.com/pcv/`. Call that the
`BASE`. All API urls will be relative to that.

List data set labels
--------------------

URL: BASE/viz/{dataset-name}/labels.json
RETURNS: A JSON array of the labels present in the dataset


Get data set definition
-----------------------

URL: BASE/viz/{dataset-name}/input.json
RETURNS: A JSON structure describing the data set


Get matrix structure
--------------------

URL: BASE/viz/{dataset-name}/{matrix-path}/matrix.json
RETURNS: The JSON object used for rendering the selected matrix-path


Authenticated APIs
==================

pcapviz supports a few REST APIs capable of modifying the
application. These require the use of
[http-signature](https://tools.ietf.org/html/draft-cavage-http-signatures-10)
authorization using public keys. Authentication details are described
after the list of API endpoints. A few informative APIs are available
by sending GET requests. These are not yet documented.

Sample utilities for invoking the APIs from python and from node are
provided: `util/apitool.py` and `util/apitool.js`. These handle
authentication and can be used directly or as examples for how to
invoke the APIs in your own code. The utilities leave a bit to be
desired, but they are complete enough to use as-is. Both support
`--help` as a first parameter to display usage information.

All URLs in the API definitions below are rooted in the base URL
defined by the port and url_root defined in the configuration. Assume
your pcapviz installation is at `https://site.com/pcv/`. Call that the
`BASE`. All API urls will be relative to that. **Be certain to use
the proper scheme (http/https) or there will be silent errors**


Verify authentication works
---------------------------

Method: POST
URL:  BASE/check_auth
BODY: ignored
AUTH: any
RESPONSE: a json object describing success or failure of the auth check

Example: with dataset-name=sample

    ./util/apitool.js username:path/to/key check https://site.com/pcv/


Update or add input source
---------------------------

Method: PUT
URL:  BASE/viz/{dataset-name}
BODY: a json payload conforming to the object format described in
      INPUT DATA above.
AUTH: The body digest, date, and (request-target) must be signed
RESPONSE: The JSON object describing the input source

Example: with dataset-name=sample

    ./util/apitool.js username:path/to/key update https://site.com/pcv/viz/sample '{"file": "sample-flows.gz","title": "Sample Netflow"}'

Note: the update action also forces a reload of the data set.


Delete input source
-------------------

Method: DELETE
URL:  BASE/viz/{dataset-name}
BODY: ignored
AUTH: The date and (request-target) must be signed
RESPONSE: The JSON object describing the now-deleted input source

Example: with dataset-name=sample

    ./util/apitool.js username:path/to/key delete https://site.com/pcv/viz/sample


Reload input source
---------------------

Method: POST
URL:  BASE/viz/{dataset-name}/reload
BODY: ignored
AUTH: The date and (request-target) must be signed
RESPONSE: An HTTP redirect to the list of inputs

Example: with dataset-name=sample

    ./util/apitool.js username:path/to/key reload https://site.com/pcv/viz/sample


API Authentication
==================

All APIs require the use of
[http-signature](https://tools.ietf.org/html/draft-cavage-http-signatures-10)
authorization using public keys.

Each user can generate their keys using OpenSSL:

    openssl genpkey -algorithm RSA -out private_key.pem -pkeyopt rsa_keygen_bits:2048; openssl rsa -pubout -in private_key.pem -out public_key.pem

Users must keep control of their private keys. They will send send
only the public key to the administrator of the pcapviz installation.

The administrator will add the public_key.pem into the
`pcapviz:key_dir` directory, with a file name of `username.pem`. The
new credential can be used immediately. The `username` used is the
keyID used in the authentication signature.

To revoke trust in a key, simply delete it from the `key_dir`
directory.

Prerequisites
=============

Installation requires an Internet connection for the node.js
prerequisite download. No Internet connection is needed once `npm
install` is complete.

Presumes the presence of `make`, `tr`, `sed`, `sort`, `gzip`,
`/etc/services`, and `node`. If reading from a pcap, `tshark` is
required as well. A project goal is to reduce these dependencies over
time.

apitool.js
-----------

`apitool.js` has depependencies on 'request'. The request library is
already installed as a dependency of pcapviz itself.


apitool.py
----------

`apitool.py` has dependencies on requests-http-signature, requests,
cryptography, and python 3.6 or newer. These are listed in
`util/Pipfile`. The easiest way to run this tool is to `cd` into the
`util` directory and run `pipenv install` once. Later the utility
itself can be run from that directory using `pipenv run ./apitool.py ...`


Installing and Running
======================

    git clone https://github.gatech.edu/ekobrin3/2019-Spring-CSE6242-pcapviz.git
    npm install
    npm start

Then go to the url displayed at the console to see sample data.

See INPUTS above to adjust which network data files are processed.

If you want a more robust setup, use `nginx` as a reverse proxy and
`pm2` for process management, as described below.


Configuration
=============

Install-time
------------

The following option affects the program's behavior at
install-time. If you want to change it after running `npm install`,
run: `npm run make -- -B services` to regenerate the services file.

   npm config set pcapviz:services_file "/path/to/servces"

The default value is '/etc/services'


Runtime
-------

To cap the number of records processed, set `pcapviz:max_records` to a
number. To process all records in each input, set it to the empty string
or "all".

    npm config set pcapviz:max_records "10000"  #process first 10k records
    npm config set pcapviz:max_records "all"    #process all records

The IP and port to bind, and the URL root are configurable.
For example:

    npm config set pcapviz:port 8080
    npm config set pcapviz:listen_ip 127.0.0.1
    npm config set pcapviz:url_root pcv

Will make the application available at: http://127.0.0.1:8080/pcv/

Setting `url_root` to the empty string or to `/` will serve it from '/'.

The directory from which public keys for API authentication will be
loaded is set as follows:

    npm config set pcapviz:key_dir public_keys

The path a local file path relative to where the server is started
from. The default value is `public_keys`.


Running Under NGINX
-------------------

Execute `npm run conf_nginx` to put a reasonable nginx config file in
`nginx/pcapviz.conf`. This file is suitable for inclusion in a
`server{}` block in your nginx configuration.

For example, if your nginx config contains the following (which is
default from Amazon Linux 2):
    server {
        listen       80 default_server;
        listen       [::]:80 default_server;
        server_name  _;
        root         /usr/share/nginx/html;

        # Load configuration files for the default server block.
        include /etc/nginx/default.d/*.conf;
        ...
    }

Then you can configure nginx by running the following, assuming you've
already enabled nginx (`sudo systemctl enable nginx`):

    npm config set pcapviz:url_root pcv
    npm run conf_nginx
    sudo cp nginx/pcapviz.conf /etc/nginx/default.d/
    sudo systemctl restart nginx
    npm start #consider using pm2 instead (see below)

Now pcapviz is running at http://*your_hostname*/pcv/


PM2
---

If [PM2](https://pm2.io) is installed, you can get process management
for pcapviz. Use `pm2 start` instead of `npm start`. Use `pm2 status`
to see process status and `pm2 stop pcapviz` to stop the server. This
all works particularly well with nginx.


Acknowledgments
===============

PCAP sample data is from
https://iscxdownloads.cs.unb.ca/iscxdownloads/ISCX-Bot-2014/ISCX_Botnet-Training.pcap

Loading graphics (images/loading*.gif) are in the public domain and
were generated using
http://www.ajaxload.info/

Public domain transparent favicon is from
http://transparent-favicon.info/favicon.ico

Express template system for DOM manipulation (lib/jsdt.js) is inspired
by https://github.com/AndersDJohnson/express-views-dom but shares no
code with it.

nginx configuration guidance from
https://www.digitalocean.com/community/tutorials/how-to-set-up-a-node-js-application-for-production-on-ubuntu-16-04
was helpful. It took some tweaking to make it work on Amazon Linux 2.

Pre-deployment testing was made possible by Amazon's guide to running
an EC2-like Linux image in VirtualBox:
https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/amazon-linux-2-virtual-machine.html

Checkbox icon and label control icon were created from scratch in GiMP
and Inkscape, respectively.

Gear icon is in the public domain:
https://publicdomainvectors.org/en/free-clipart/Tool-options/67662.html

See package.json for a list of server-side dependencies.

License
=======

BSD 2-clause license. See LICENSE file for details.
