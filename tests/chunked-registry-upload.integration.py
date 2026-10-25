#!/usr/bin/env python3
"""Verify chunked registry uploads survive a dropped PATCH without re-uploading prior chunks."""
from pathlib import Path
import concurrent.futures, gzip, hashlib, http.client, http.server, io, json, os, socket, subprocess, tarfile, tempfile, threading, time, urllib.request

def run(args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, text=True, **kwargs)

with tempfile.TemporaryDirectory(prefix='vinci-chunk-upload-test-') as folder:
    root=Path(folder)
    source=root/'source'; (source/'blobs'/'sha256').mkdir(parents=True)
    (source/'oci-layout').write_text('{"imageLayoutVersion":"1.0.0"}')
    def blob(raw, media):
        digest=hashlib.sha256(raw).hexdigest()
        (source/'blobs'/'sha256'/digest).write_bytes(raw)
        return {'mediaType':media,'digest':'sha256:'+digest,'size':len(raw)}
    def document(value, media):
        return blob(json.dumps(value,separators=(',',':')).encode(),media)
    contents=os.urandom(12*1024*1024)
    stream=io.BytesIO()
    with tarfile.open(fileobj=stream,mode='w') as tar:
        entry=tarfile.TarInfo('probe.bin');entry.size=len(contents)
        tar.addfile(entry,io.BytesIO(contents))
    raw_layer=stream.getvalue()
    layer=blob(gzip.compress(raw_layer,mtime=0),'application/vnd.oci.image.layer.v1.tar+gzip')
    manifests=[]
    for arch in ['amd64','arm64']:
        config=document({'architecture':arch,'os':'linux','rootfs':{'type':'layers','diff_ids':['sha256:'+hashlib.sha256(raw_layer).hexdigest()]}},'application/vnd.oci.image.config.v1+json')
        image=document({'schemaVersion':2,'mediaType':'application/vnd.oci.image.manifest.v1+json','config':config,'layers':[layer]},'application/vnd.oci.image.manifest.v1+json')
        image['platform']={'os':'linux','architecture':arch};manifests.append(image)
    index=document({'schemaVersion':2,'mediaType':'application/vnd.oci.image.index.v1+json','manifests':manifests},'application/vnd.oci.image.index.v1+json')
    index['annotations']={'org.opencontainers.image.ref.name':'release'}
    (source/'index.json').write_text(json.dumps({'schemaVersion':2,'manifests':[index]}))
    run(['skopeo','copy','--all','--preserve-digests','oci:'+str(source)+':release','oci:'+str(root/'cache')+':release'])
    name='vinci-chunk-upload-test-'+str(os.getpid())
    run(['docker','run','--rm','--detach','--name',name,'--label','codex.task=vinci-tcr-sync-test','--publish','127.0.0.1::5000','registry:3'])
    proxy=None
    try:
        address=run(['docker','port',name,'5000/tcp']).stdout.strip().split(':')
        backend_port=int(address[-1])
        for _ in range(30):
            try:
                urllib.request.urlopen('http://127.0.0.1:'+str(backend_port)+'/v2/',timeout=1).close();break
            except Exception:time.sleep(0.1)
        class Proxy(http.server.BaseHTTPRequestHandler):
            protocol_version='HTTP/1.1'
            patch_sizes=[]
            dropped=False
            def log_message(self,*args): pass
            def handle(self):
                try:super().handle()
                except (ConnectionResetError, BrokenPipeError):pass
            def handle_method(self):
                length=int(self.headers.get('Content-Length','0'))
                data=self.rfile.read(length) if length else None
                if self.command=='PATCH':
                    type(self).patch_sizes.append(length)
                    if len(type(self).patch_sizes)==2 and not type(self).dropped:
                        type(self).dropped=True
                        self.connection.shutdown(socket.SHUT_RDWR)
                        self.connection.close();self.close_connection=True;return
                conn=http.client.HTTPConnection('127.0.0.1',backend_port,timeout=30)
                headers={k:v for k,v in self.headers.items() if k.lower() not in ['connection','transfer-encoding']}
                conn.request(self.command,self.path,data,headers)
                response=conn.getresponse();body=response.read()
                self.send_response(response.status)
                for key,value in response.getheaders():
                    if key.lower() not in ['connection','transfer-encoding','content-length','server','date']:
                        value=value.replace('http://127.0.0.1:'+str(backend_port),'http://'+self.headers['Host'])
                        self.send_header(key,value)
                self.send_header('Content-Length',str(len(body)));self.end_headers()
                if self.command!='HEAD':self.wfile.write(body)
                conn.close()
            do_GET=handle_method;do_HEAD=handle_method;do_POST=handle_method;do_PATCH=handle_method;do_PUT=handle_method;do_DELETE=handle_method
        proxy=http.server.ThreadingHTTPServer(('127.0.0.1',0),Proxy)
        thread=threading.Thread(target=proxy.serve_forever,daemon=True);thread.start()
        target='127.0.0.1:'+str(proxy.server_address[1])
        env={**os.environ,'REGCTL_CONFIG':str(root/'regctl.json')}
        tool=os.environ.get('REGCTL_BIN', 'regctl')
        run([tool,'registry','set',target,'--tls','disabled','--blob-max','8388608','--blob-chunk','8388608','--req-concurrent','2'],env=env)
        started=time.monotonic()
        result=run([tool,'image','copy','--force-recursive','--verbosity','info','ocidir://'+str(root/'cache')+':release',target+'/vinci/probe:test'],env=env,timeout=60)
        raw=subprocess.check_output(['skopeo','inspect','--tls-verify=false','--raw','docker://'+target+'/vinci/probe:test'])
        assert 'sha256:'+hashlib.sha256(raw).hexdigest()==index['digest']
        assert Proxy.dropped and len(Proxy.patch_sizes)>=3,Proxy.patch_sizes
        assert max(Proxy.patch_sizes)<=8388608,Proxy.patch_sizes
        assert Proxy.patch_sizes[0]==8388608 and Proxy.patch_sizes[1]==Proxy.patch_sizes[2],Proxy.patch_sizes
        print('Chunked upload passed with an injected connection drop')
        print('PATCH payload sizes:',Proxy.patch_sizes)
        print('Complete multi-platform index digest preserved:',index['digest'])
        print('Elapsed seconds:',round(time.monotonic()-started,2))
    finally:
        if proxy:proxy.shutdown();proxy.server_close()
        subprocess.run(['docker','stop','--time','2',name],capture_output=True)
