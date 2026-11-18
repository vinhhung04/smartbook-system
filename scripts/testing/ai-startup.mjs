// QA uses the same explicit owner-before-runtime boundary as production.
export function startAi(compose) {
  compose('--profile', 'ai', 'build', 'ai-service');
  compose('--profile', 'ai', 'run', '--rm', '--no-deps', '-T', '--entrypoint', 'python', 'ai-service', 'migrate.py');
  compose('--profile', 'ai', 'up', '-d', '--no-build', '--wait', '--wait-timeout', '300', 'ai-service');
}
