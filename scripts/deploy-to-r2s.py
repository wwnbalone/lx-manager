#!/usr/bin/env python3
"""Deploy lx-manager to R2S via SSH/SFTP."""

import os
import sys
import stat
import paramiko
import posixpath

# Connection settings
HOST = "192.168.100.1"
PORT = 22
USER = "root"
PASSWORD = "T8v7NneYd2SgxG8@@"

# Paths
LOCAL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REMOTE_DIR = "/opt/lx-manager"

# Directories/files to exclude from sync
EXCLUDE = {
    "node_modules",
    ".kiro",
    "logs",
    "sources",
    ".git",
    "scripts/deploy-to-r2s.py",
}


def should_exclude(rel_path):
    """Check if a relative path should be excluded."""
    parts = rel_path.replace("\\", "/").split("/")
    for part in parts:
        if part in EXCLUDE:
            return True
    if rel_path.replace("\\", "/") in EXCLUDE:
        return True
    return False


def ssh_exec(ssh, cmd, check=True):
    """Execute a command via SSH and return stdout."""
    print(f"  [SSH] {cmd}")
    stdin, stdout, stderr = ssh.exec_command(cmd)
    exit_code = stdout.channel.recv_exit_status()
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out:
        print(f"        {out}")
    if err and exit_code != 0:
        print(f"  [ERR] {err}")
    if check and exit_code != 0:
        raise RuntimeError(f"Command failed (exit {exit_code}): {cmd}\n{err}")
    return out


def sftp_mkdir_p(sftp, remote_path):
    """Recursively create remote directories."""
    dirs_to_create = []
    path = remote_path
    while True:
        try:
            sftp.stat(path)
            break
        except FileNotFoundError:
            dirs_to_create.append(path)
            path = posixpath.dirname(path)
            if path == "/" or path == "":
                break
    for d in reversed(dirs_to_create):
        try:
            sftp.mkdir(d)
        except IOError:
            pass


def upload_directory(sftp, local_dir, remote_dir):
    """Upload a local directory to remote, excluding specified paths."""
    file_count = 0
    for root, dirs, files in os.walk(local_dir):
        rel_root = os.path.relpath(root, local_dir)
        if rel_root == ".":
            rel_root = ""

        # Filter out excluded directories in-place
        dirs[:] = [
            d for d in dirs
            if not should_exclude(os.path.join(rel_root, d) if rel_root else d)
        ]

        for fname in files:
            rel_path = os.path.join(rel_root, fname) if rel_root else fname
            if should_exclude(rel_path):
                continue

            local_path = os.path.join(root, fname)
            remote_path = posixpath.join(
                remote_dir, rel_path.replace("\\", "/")
            )

            # Ensure remote directory exists
            remote_file_dir = posixpath.dirname(remote_path)
            sftp_mkdir_p(sftp, remote_file_dir)

            # Upload file
            sftp.put(local_path, remote_path)
            file_count += 1
            if file_count % 10 == 0:
                print(f"  Uploaded {file_count} files...")

    return file_count


def main():
    print(f"=== Deploying lx-manager to {HOST} ===")
    print(f"Local:  {LOCAL_DIR}")
    print(f"Remote: {REMOTE_DIR}")
    print()

    # Connect
    print("[1/5] Connecting via SSH...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=10)
    print("  Connected!")

    # Stop service
    print("\n[2/5] Stopping lx-manager service...")
    ssh_exec(ssh, "/etc/init.d/lx-manager stop", check=False)

    # Clean remote app directory (keep node_modules to speed up npm ci)
    print("\n[3/5] Cleaning remote directory (preserving node_modules)...")
    ssh_exec(ssh, f"mkdir -p {REMOTE_DIR}")
    # Remove everything except node_modules
    ssh_exec(
        ssh,
        f"find {REMOTE_DIR} -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {{}} +",
        check=False,
    )

    # Upload files
    print("\n[4/5] Uploading files...")
    sftp = ssh.open_sftp()
    count = upload_directory(sftp, LOCAL_DIR, REMOTE_DIR)
    sftp.close()
    print(f"  Done! Uploaded {count} files.")

    # Install dependencies and restart
    print("\n[5/5] Installing dependencies and restarting service...")
    ssh_exec(ssh, f"cd {REMOTE_DIR} && npm ci --omit=dev 2>&1 | tail -5")
    ssh_exec(ssh, "/etc/init.d/lx-manager start", check=False)

    # Verify
    print("\n=== Verifying deployment ===")
    result = ssh_exec(ssh, "curl -s http://127.0.0.1:4000/health", check=False)
    if result:
        print(f"  Health check: {result}")
    else:
        print("  Warning: Health check returned empty. Service may still be starting.")
        print("  Try: ssh root@192.168.100.1 'curl http://127.0.0.1:4000/health'")

    ssh.close()
    print("\n=== Deployment complete! ===")


if __name__ == "__main__":
    main()
