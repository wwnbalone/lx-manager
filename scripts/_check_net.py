import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.100.1', username='root', password='T8v7NneYd2SgxG8@@')

# Check network interfaces and their IPs
i, o, e = ssh.exec_command('ip addr show | grep -E "inet |^[0-9]"')
print("=== Interfaces ===")
print(o.read().decode())

# Check which interface has 192.168.100.1
i, o, e = ssh.exec_command('ip addr show | grep 192.168.100')
print("=== 192.168.100.1 interface ===")
print(o.read().decode())

# Check UCI network to see which interface is lan vs wan
i, o, e = ssh.exec_command('uci show network | grep -E "interface|device|ipaddr|proto"')
print("=== UCI network ===")
print(o.read().decode()[:3000])

# Check nft input chain for lan zone
i, o, e = ssh.exec_command('nft list chain inet fw4 input 2>/dev/null')
print("=== nft input chain ===")
print(o.read().decode()[:3000])

ssh.close()
