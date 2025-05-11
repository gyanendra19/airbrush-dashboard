module.exports = {
  apps: [{
    name: 'server',
    script: 'server.js',
    instances: 1,
    exec_mode: 'cluster',
    watch: true,
    ignore_watch: ['node_modules', 'logs', '.git'],
    max_memory_restart: '1G',
    env_production: {
      NODE_ENV: 'production',
      PORT: 10000
    },
    exp_backoff_restart_delay: 100,
    max_restarts: 10,
    min_uptime: '5s',
    listen_timeout: 50000,
    kill_timeout: 5000,
    merge_logs: true,
    error_file: 'logs/err.log',
    out_file: 'logs/out.log',
    log_file: 'logs/combined.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    time: true
  }]
}; 