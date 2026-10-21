# Deploy MetaSwap on Oracle Cloud (Always Free)

One free ARM server (4 CPU / 24 GB) runs everything in a single Docker container: the MetaChain
Devnet (booted from your saved chain), the API, the live market and the website, all served on
port 80.

## Part 1: Create the server (once, about 15 minutes)

1. **Sign up** at <https://www.oracle.com/cloud/free/>.
   - Pick a **Home Region** carefully, because it can't be changed later. Free ARM servers often run
     out in busy regions. Good choices are *India South (Hyderabad)*, *India West (Mumbai)*, or any
     less popular region.
   - A card is required for identity verification. Always Free resources are not charged.
2. In the Oracle console, open **☰ → Compute → Instances → Create instance**.
   - **Name:** `metaswap`
   - **Image and shape → Edit:**
     - **Image:** *Change image → Canonical Ubuntu → 24.04* (the aarch64 build is picked
       automatically for ARM).
     - **Shape:** *Change shape → Ampere → VM.Standard.A1.Flex*, set **4 OCPUs** and **24 GB**
       memory. It must show "Always Free-eligible".
   - **Networking:** keep "Create new virtual cloud network" and "Create new public subnet", and make
     sure **Assign a public IPv4 address** is ticked.
   - **Add SSH keys:** choose **Generate a key pair for me**, then click **Save private key** and
     save it as `C:\Users\<you>\.ssh\oracle.key`.
   - Click **Create**. When the status is **Running**, copy the **Public IPv4 address**.
   - If you see "Out of capacity": wait a while and retry, or pick another *Availability domain* in
     the Placement section.
3. **Open port 80 in Oracle's network:** on the instance page, click the **Subnet** link, then the
   **Default Security List**, then **Add Ingress Rules**:
   - Source CIDR `0.0.0.0/0`, IP Protocol **TCP**, Destination Port Range **80**, then **Add**.

## Part 2: Make the app bundle (on your PC)

In the `metaswap` folder (`npm run dev` must have run at least once, so a chain is saved):

```bash
node scripts/export-demo.mjs
```

This creates `.dev\metaswap-demo.tar.gz` (~23 MB), containing the code plus your saved chain.

## Part 3: Copy, build and run (replace YOUR_IP)

1. If Windows says the key file is "too open", restrict it first:

```bash
icacls %USERPROFILE%\.ssh\oracle.key /inheritance:r
```

```bash
icacls %USERPROFILE%\.ssh\oracle.key /grant:r "%USERNAME%:R"
```

2. Copy the bundle to the server:

```bash
scp -i %USERPROFILE%\.ssh\oracle.key .dev\metaswap-demo.tar.gz ubuntu@YOUR_IP:~
```

3. Log in to the server:

```bash
ssh -i %USERPROFILE%\.ssh\oracle.key ubuntu@YOUR_IP
```

4. On the server, install Docker:

```bash
curl -fsSL https://get.docker.com | sudo sh
```

5. Unpack and build. The first build takes about 5–10 minutes.

```bash
mkdir -p metaswap && tar -xzf metaswap-demo.tar.gz -C metaswap && cd metaswap
```

```bash
sudo docker build -t metaswap .
```

6. Start it. It restarts automatically after reboots.

```bash
sudo docker run -d --name metaswap --restart unless-stopped -p 80:7860 -e VITE_WALLETCONNECT_PROJECT_ID=YOUR_PROJECT_ID metaswap
```

7. Open port 80 in Ubuntu's own firewall. Oracle images block it by default.

```bash
sudo iptables -I INPUT 6 -p tcp --dport 80 -j ACCEPT && sudo netfilter-persistent save
```

8. Wait about 2–3 minutes (the website builds on first start), then open **http://YOUR_IP**.

Check progress or problems with:

```bash
sudo docker logs -f metaswap
```

## Updating later

1. On your PC, rebuild the bundle with `node scripts/export-demo.mjs`.
2. Copy it again with the `scp` command from step 2.
3. On the server, remove the old container:

```bash
sudo docker rm -f metaswap
```

4. Repeat steps 5 and 6.

## Notes

- Visitors cannot reset or wipe the chain: the gateway blocks admin RPC methods, but the faucet
  still works.
- The link is plain `http://`. Browser wallets work fine. For `https://`, add a domain and a reverse
  proxy such as Caddy later.
