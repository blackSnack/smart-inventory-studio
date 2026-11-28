import {BlockList,isIP} from 'node:net';

const privateAddresses=new BlockList();
privateAddresses.addSubnet('10.0.0.0',8,'ipv4');
privateAddresses.addSubnet('172.16.0.0',12,'ipv4');
privateAddresses.addSubnet('192.168.0.0',16,'ipv4');
privateAddresses.addSubnet('127.0.0.0',8,'ipv4');
privateAddresses.addSubnet('fc00::',7,'ipv6');
privateAddresses.addAddress('::1','ipv6');

export function isPrivateOrLoopbackAddress(address) {
  const family=isIP(address);
  if(family===4)return privateAddresses.check(address,'ipv4');
  if(family===6){
    const mapped=address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
    return mapped?privateAddresses.check(mapped[1],'ipv4'):privateAddresses.check(address,'ipv6');
  }
  return false;
}
