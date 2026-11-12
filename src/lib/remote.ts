/** Public owner avatars; unavailable or private metadata falls back to initials. */
export async function ownerAvatar(remote: { host: string; owner: string; path: string }, signal: AbortSignal): Promise<string | null> {
  const owner = encodeURIComponent(remote.owner);
  if (remote.host === 'github.com') return `https://github.com/${owner}.png?size=64`;
  const endpoint = remote.host === 'gitlab.com'
    ? `https://gitlab.com/api/v4/projects/${encodeURIComponent(remote.path)}`
    : remote.host === 'bitbucket.org' ? `https://api.bitbucket.org/2.0/workspaces/${owner}` : null;
  if (!endpoint) return null;
  const response = await fetch(endpoint, { signal, credentials: 'omit' });
  if (!response.ok) return null;
  const data: unknown = await response.json();
  let avatar: unknown;
  if (data && typeof data === 'object') {
    if ('namespace' in data && data.namespace && typeof data.namespace === 'object' && 'avatar_url' in data.namespace) {
      avatar = data.namespace.avatar_url;
    } else if ('links' in data && data.links && typeof data.links === 'object' && 'avatar' in data.links) {
      const link = data.links.avatar;
      if (link && typeof link === 'object' && 'href' in link) avatar = link.href;
    }
  }
  if (typeof avatar !== 'string' || !avatar) return null;
  const url = new URL(avatar, endpoint);
  return url.protocol === 'https:' ? url.href : null;
}
