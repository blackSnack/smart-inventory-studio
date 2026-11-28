const endpoint=process.argv[2];
let raw='';
for await (const chunk of process.stdin) raw+=chunk;
let payload;
try { payload=JSON.parse(raw.replace(/^\uFEFF/,'').trim()); }
catch { console.error('Invalid setup input.'); process.exit(2); }
try {
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Origin:new URL(endpoint).origin},body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(15000)});
  const result=await response.json().catch(()=>null);
  if(!response.ok||result?.authenticated!==true){console.error('Gateway setup failed (HTTP '+response.status+').');process.exit(1);}
  console.log('Gateway administrator setup completed. The one-time token was consumed; the password was not saved.');
} catch {
  console.error('Gateway setup could not reach the HTTPS endpoint using the configured local CA.');
  process.exit(1);
}
