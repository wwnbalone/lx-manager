import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.100.1', username='root', password='T8v7NneYd2SgxG8@@')

# Check input_lan chain
i, o, e = ssh.exec_command('nft list chain inet fw4 input_lan 2>/dev/null')
print("=== input_lan chain ===")
print(o.read().decode())

# Also check if there's a reject at the end of input
i, o, e = ssh.exec_command('nft list chain inet fw4 handle_reject 2>/dev/null')
print("=== handle_reject chain ===")
print(o.read().decode())

# Try to access from the R2S itself to confirm service works
i, o, e = ssh.exec_command('curl -s -o /dev/null -w "%{http_code}" http://192.168.100.1:4000/health')
print("=== curl to 192.168.100.1:4000 ===")
print("HTTP status:", o.read().decode())

ssh.close()
