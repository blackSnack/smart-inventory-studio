"""Synthetic public fixture: actual QR C123456 + Code128 C123456, no user media."""
import struct,zlib,json
MATRIX="""00000000000000000000000000000
00000000000000000000000000000
00000000000000000000000000000
00000000000000000000000000000
00001111111000100011111110000
00001000001000100010000010000
00001011101001010010111010000
00001011101000111010111010000
00001011101001101010111010000
00001000001011111010000010000
00001111111010101011111110000
00000000000000011000000000000
00001001011011100101000000000
00001010100111000010010000000
00000101101101001100001000000
00000010010101110000001010000
00000010011010101010110010000
00000000000011010001111010000
00001111111001000101010010000
00001000001010111101110010000
00001011101001010011100110000
00001011101011010001011110000
00001011101001001000100010000
00001000001001100111000010000
00001111111010111001111000000
00000000000000000000000000000
00000000000000000000000000000
00000000000000000000000000000
00000000000000000000000000000""".splitlines()
def label_png():
 w,h=560,390
 pixels=bytearray([255])*(w*h)
 def rectangle(x,y,ww,hh):
  for j in range(y,y+hh):pixels[j*w+x:j*w+x+ww]=bytes(ww)
 for y,row in enumerate(MATRIX):
  for x,v in enumerate(row):
   if v=='1':rectangle(190+x*6,10+y*6,6,6)
 # Code128 encoded values 104,35,99,12,34,56,68,106 (C123456).
 x=65
 for b in 'BaAbAdAcAcBaAaCaDaAaBbCbAcAaBcCcAaBaAdAbBaBcCaAaB':
  width=(ord(b.lower())-96)*4
  if b.isupper():rectangle(x,210,width,120)
  x+=width
 assert x<w
 def chunk(t,data):return struct.pack('>I',len(data))+t+data+struct.pack('>I',zlib.crc32(t+data)&0xffffffff)
 scan=b''.join(b'\x00'+pixels[y*w:(y+1)*w] for y in range(h))
 return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,0,0,0,0))+chunk(b'IDAT',zlib.compress(scan))+chunk(b'IEND',b'')
def response_label(maker='Fixture Maker',mpn='FIX-10K',supplier='Fixture Supplier',sku='SKU-10K',name='SMD resistor'):
 return {'kind':'package','readability':'clear','rawText':f'{maker}\n{mpn}\n{supplier}\n{sku}\n{name}\n10kΩ 0603 QTY: 15','name':name,'manufacturer':maker,'mpn':mpn,'supplier':supplier,'sku':sku,'category':'capacitor.ceramic','parameters':{'resistance':'10kΩ','package':'0603','rated_power':'0.5 W'}}
def completion(draft):
 return {'choices':[{'message':{'content':json.dumps(draft,ensure_ascii=False)}}]}
def gateway_route(route,draft):
 headers={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'POST, OPTIONS'}
 if route.request.method=='OPTIONS':route.fulfill(status=204,headers=headers);return
 assert route.request.method=='POST'
 body=route.request.post_data_json
 assert body['messages'][1]['content'][1]['image_url']['url'].startswith('data:image/jpeg;base64,')
 assert 'Packaging-first' in body['messages'][0]['content']
 route.fulfill(json=completion(draft),headers=headers)
