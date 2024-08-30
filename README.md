# cloudflare-docker-proxy

![deploy](https://github.com/hyec/cloudflare-docker-proxy/actions/workflows/deploy.yaml/badge.svg)

Proxy for all docker registries with Cloudflare Workers, with only one domain.

eg: 
```shell
$ docker pull cr-proxy.yourname.workers.dev/ubuntu
$ docker pull cr-proxy.yourname.workers.dev/ghcr.io/coder/coder
$ docker pull cr-proxy.yourname.workers.dev/registry.k8s.io/kube-state-metrics/kube-state-metrics
```

## Deploy

1. click the "Deploy With Workers" button
2. follow the instructions to fork and deploy
3. update routes as you requirement

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/hyec/cloudflare-docker-proxy)

## Authorization

You could enable Authorization for your proxy, in case too many requests from anonymous;

Add a secret environment named `AUTH_CREDENTIALS` with format `username:password`

Use wrangler to set the secret:
```shell
$ npx wrangler secret put AUTH_CREDENTIALS
Enter a secret value: test:test123
```

or via the Cloudflare Dashboard.

Use [`docker login`](https://docs.docker.com/reference/cli/docker/login/) to save the credential.

## Use as K3s Registry Mirrors

Reference the [Embedded Registry Mirror](https://docs.k3s.io/installation/private-registry) instructions.

eg:
```yaml
mirrors:
  docker.io:
    endpoint:
      - "https://cr-proxy.yourname.workers.dev"
    rewrite:
      "^(.*)$": "docker.io/$1"
  ghcr.io:
    endpoint:
      - "https://cr-proxy.yourname.workers.dev"
    rewrite:
      "^(.*)$": "ghcr.io/$1"
```
