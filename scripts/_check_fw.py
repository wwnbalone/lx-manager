import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.100.1', username='root', password='T8v7NneYd2SgxG8@@')

# Check nftables
i, o, e = ssh.exec_command('nft list ruleset 2>/dev/null | head -80')
print("=== nft rules (first 80 lines) ===")
print(o.read().decode()[:4000])

# Check if it's a zone issue
i, o, e = ssh.exec_command('uci show firewall | grep -E "zone|rule" | head -30')
print("\n=== UCI firewall zones ===")
print(o.read().decode()[:2000])

ssh.close()
