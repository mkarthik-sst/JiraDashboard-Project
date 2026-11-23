// pm2 process file:  npm i -g pm2 && pm2 start deploy/ecosystem.config.cjs && pm2 save
module.exports = { apps: [{ name: "cleancore-defect-hub", script: "npm", args: "run start", cwd: __dirname + "/..", env: { NODE_ENV: "production", PORT: "3000" }, max_restarts: 10, autorestart: true }] };
