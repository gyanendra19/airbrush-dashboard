module.exports = {
    apps: [{
      name: 'server',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork', // Render works better with fork mode
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 8000
      },
      exp_backoff_restart_delay: 100,
      max_restarts: 10,
      min_uptime: '5s',
      listen_timeout: 50000,
      kill_timeout: 5000,
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      combine_logs: true,
      merge_logs: true
    }]
  };
  