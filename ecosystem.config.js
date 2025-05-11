module.exports = {
  apps: [{
    name: 'server',
    script: 'server.js',
    instances: 1,
    exec_mode: 'cluster',
    watch: false,
    max_memory_restart: '1G',
    env_production: {
      NODE_ENV: 'production',
      PORT: process.env.PORT || 8000
    },
    exp_backoff_restart_delay: 100,
    max_restarts: 10,
    min_uptime: '5s',
    listen_timeout: 50000,
    kill_timeout: 5000
  }],
  deploy: {
    production: {
      // Render specific deployment settings
      ssh_options: 'StrictHostKeyChecking=no',
      key: process.env.SSH_KEY || undefined,
      user: process.env.DEPLOY_USER || 'render',
      host: process.env.DEPLOY_HOST || 'airbrush-dashboard.onrender.com',
      ref: 'origin/main',
      repo: 'https://github.com/gyanendra19/airbrush-dashboard.git',
      path: '/opt/render/project/src',
      'pre-deploy-local': '',
      'post-deploy': 'npm install && pm2 reload ecosystem.config.js --env production',
      'pre-setup': '',
      env: {
        NODE_ENV: 'production'
      }
    }
  }
}; 