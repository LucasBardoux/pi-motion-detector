# pi-motion-detector

### add to starup with pm2

Run the following command:
```bash
pm2 start npm --name "pi-motion-detection" -- start

pm2 startup

# enter the command which will be returned by pm2 startup

pm2 save
```

### start and stop with cron job (optional)

Add the toggle-motion.sh to the root of the repository
```bash
#!/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
# adjust the home path
HOME=/home/user
export PM2_HOME=$HOME/.pm2

# go into directory
cd $HOME/pi-motion-detector

# execute start stop
/usr/bin/pm2 $1 pi-motion-detector >> $HOME/pi-motion-detector/cron_log.log 2>&1
```

Make the toggle-motion.sh executable

```bash
# adjust the user path
chmod +x /home/user/pi-motion-detector/toggle-motion.sh
```

Run the following command: 
```bash
crontab -e
```

Scroll to the end and insert:

```bash
# adjust the user path (also in the toggle-motion.sh)
0 8 * * * /home/user/pi-motion-detector/toggle-motion.sh start
0 18 * * * /home/user/pi-motion-detector/toggle-motion.sh stop
```