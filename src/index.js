
const defaultUpstream = "registry-1.docker.io";

function decodeBase64(data) {
  return atob(data);
}

function encodeBase64(data) {
  return btoa(data);
}

/**
 * handle the authorization header, parse the tokens of requested upstream
 * @param {Request} request 
 * @param {object} env 
 * @returns {[boolean, object]}
 */
function handleAuthorization(request, env) {

  const rawHeader = request.headers.get("Authorization");
  let authorized = true;
  let registriesTokens = {};

  if (rawHeader) {

    const [scheme, credentials] = rawHeader.split(' ', 2);
    const decoded = decodeBase64(credentials ?? '');

    if (scheme.toLowerCase() === "basic") {
      registriesTokens['self'] = decoded;
    } else if (scheme.toLowerCase() === "bearer") {
      registriesTokens = JSON.parse(decoded);
    } else {
      throw new Error("unexpected authorization: ", rawHeader);
    }
  }

  if (env.AUTH_CREDENTIALS) {
    authorized = registriesTokens['self'] === env.AUTH_CREDENTIALS;
  }

  return [authorized, registriesTokens];
}

/**
 * redirect to auth
 * @param {Request} request 
 * @returns {Response}
 */
function redirectToAuthPath(request) {
  const url = new URL(request.url);
  return new Response(
    JSON.stringify({ message: "UNAUTHORIZED" }),
    {
      status: 401,
      headers: [
        ["Content-Type", "application/json"],
        ["Www-Authenticate", `Bearer realm="${url.protocol}//${url.hostname}/v2/auth",service="docker-proxy"`]
      ],
    }
  );
}

/**
 * split the upstream from the parts (scope parts or path parts)
 * @param {Array<String>} parts
 * @returns {[String, Array<String>]} tuple(upstream, newParts) 
 */
function splitUpstream(parts) {

  let upstream = defaultUpstream;

  if (parts.length >= 2 && parts[0].indexOf('.') >= 0) {
    upstream = parts[0];
    parts = parts.slice(1);
  }

  if (upstream === "docker.io") {
    upstream = "registry-1.docker.io"
  }

  // add `library` prefix to top level repo
  if (parts.length == 1) {
    parts = ["library"].concat(parts);
  }

  return [upstream, parts];
}


/**
 * @param {Request} request 
 * @param {object} env 
 * @returns {Promise<Response>}
 */
async function handleRequest(request, env) {
  const url = new URL(request.url);
  const [authorized, registriesTokens] = handleAuthorization(request, env);

  if (url.pathname === "/") {
    return new Response(
      JSON.stringify({ message: "Hello World!" }),
      { status: 200, headers: [['Content-Type', 'application/json']] }
    );
  } else if (url.pathname == "/v2/") {
    if (!authorized || !request.headers.get("Authorization")) {
      return redirectToAuthPath(request);
    } else {
      return new Response(
        JSON.stringify({ message: "SUCCESS" }),
        { status: 200, headers: [["Content-Type", "application/json"]] }
      );
    }
  } else if (url.pathname == "/v2/auth") {
    let scope = url.searchParams.get("scope");

    // autocomplete repo part into scope for DockerHub library images
    // Example: repository:busybox:pull => repository:library/busybox:pull
    if (scope) {

      let scopeParts = scope.split(":", 3);
      let repoParts = (scopeParts[1] ?? '').split("/");

      const [upstream, newRepoParts] = splitUpstream(repoParts);

      scopeParts[1] = newRepoParts.join("/");
      scope = scopeParts.join(":");

      const resp = await fetch(`https://${upstream}/v2/`, {
        method: "GET",
        redirect: "follow",
      });

      const authenticateStr = resp.headers.get("WWW-Authenticate");

      if (resp.status === 401 && authenticateStr) {

        const wwwAuthenticate = parseAuthenticate(authenticateStr);
        const upstreamResponse = await fetchToken(wwwAuthenticate, scope, registriesTokens[upstream]);

        registriesTokens[upstream] = (await upstreamResponse.json()).token;

        console.log(`fetched token of upstream: ${upstream}, scope: ${scope}, wwwAuthenticate: ${JSON.stringify(wwwAuthenticate)}`)
      }
    }

    return new Response(
      JSON.stringify({token: encodeBase64(JSON.stringify(registriesTokens))}), 
      { status: 200, headers: [["content-type", "application/json"]] }
    );
  }

  if (!authorized) {
    return redirectToAuthPath(request);
  }

  if (url.pathname.startsWith("/v2/")) {

    let pathParts = url.pathname.split("/");
    let repoParts = pathParts.slice(2, -2); // first two: ""/"v2"/

    let [upstream, newRepoParts] = splitUpstream(repoParts);

    let newPath = "/v2/" + newRepoParts.concat(pathParts.slice(-2)).join("/")

    // foward requests
    const newUrl = new URL("https://" + upstream + newPath); // only support https as upstream
    const newHeaders = new Headers(request.headers);

    if (registriesTokens[upstream]) {
      newHeaders.set("Authorization", "Bearer " + registriesTokens[upstream])
    } else {
      newHeaders.delete("Authorization");
    }

    console.log(`reverse proxy ${url} to ${newUrl}`)

    return await fetch(newUrl, {
      method: request.method,
      headers: newHeaders,
      redirect: "follow",
    });

  }

}

function parseAuthenticate(authenticateStr) {
  // sample: Bearer realm="https://auth.ipv6.docker.com/token",service="registry.docker.io"
  // match strings after =" and before "
  const re = /(?<=\=")(?:\\.|[^"\\])*(?=")/g;
  const matches = authenticateStr.match(re);
  if (matches == null || matches.length < 2) {
    throw new Error(`invalid Www-Authenticate Header: ${authenticateStr}`);
  }
  return {
    realm: matches[0],
    service: matches[1],
  };
}

async function fetchToken(wwwAuthenticate, scope, authorization) {
  const url = new URL(wwwAuthenticate.realm);
  if (wwwAuthenticate.service.length) {
    url.searchParams.set("service", wwwAuthenticate.service);
  }
  if (scope) {
    url.searchParams.set("scope", scope);
  }
  const headers = new Headers();
  if (authorization) {
    headers.set("Authorization", "Bearer " + authorization);
  }

  return await fetch(url, { method: "GET", headers: headers });
}

export default {
  /**
   * @param {Request} request 
   * @param {object} env 
   * @param {Context} ctx 
   */
  async fetch(request, env, ctx) {
    return await handleRequest(request, env);;
  },
};