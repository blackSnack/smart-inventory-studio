#!/usr/bin/env python3
"""Read-only explicit-target probe. No discovery, no writes, no redirects, no token output."""
import argparse, getpass, json, urllib.request, urllib.error, urllib.parse, hashlib
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*a,**kw): return None
p=argparse.ArgumentParser();p.add_argument('--url',required=True);p.add_argument('--timeout',type=int,default=15);a=p.parse_args()
u=urllib.parse.urlsplit(a.url)
if u.scheme not in ('http','https') or not u.netloc or u.username or u.password or u.query or u.fragment: p.error('URL must be explicit HTTP(S) base, no credentials/query/fragment')
base=a.url.rstrip('/'); token=getpass.getpass('Read-only InvenTree token: ')
if not token: p.error('token required')
if u.scheme=='http': print('Warning: HTTP transmits token in plaintext. Use a trusted LAN only.')
opener=urllib.request.build_opener(NoRedirect()); report={}
paths=['/api/','/api/part/?limit=1','/api/part/category/?limit=1','/api/parameter/template/?limit=1','/api/parameter/?limit=1','/api/stock/?limit=1','/api/stock/location/?limit=1','/api/schema/']
for path in paths:
    try:
        req=urllib.request.Request(base+path,headers={'Authorization':'Token '+token,'Accept':'application/json' if path!='/api/schema/' else '*/*'},method='GET')
        with opener.open(req,timeout=a.timeout) as r:
            raw=r.read(16*1024*1024+1); entry={'status':r.status,'content_type':r.headers.get_content_type()}
            if len(raw)>16*1024*1024: entry['error']='response exceeds limit'
            elif path=='/api/schema/': entry['sha256']=hashlib.sha256(raw).hexdigest();entry['bytes']=len(raw)
            else:
                try:
                    d=json.loads(raw)
                    if path=='/api/' and isinstance(d,dict): entry['version_fields']={k:v for k,v in d.items() if k in ('version','apiVersion','api_version','inventree_version','software_version') and isinstance(v,(int,str))}
                    if isinstance(d,dict) and isinstance(d.get('count'),int): entry['count']=d['count']
                    entry['json']=True
                except (ValueError,UnicodeError): entry['json']=False
            report[path]=entry
    except urllib.error.HTTPError as e: report[path]={'status':e.code,'error':'HTTP error; no redirect followed'}
    except (OSError,ValueError) as e: report[path]={'error':type(e).__name__}
print(json.dumps(report,indent=2,ensure_ascii=False))
