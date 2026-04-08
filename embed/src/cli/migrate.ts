import { randomBytes } from "node:crypto";

export interface GiscusComment {
  author: { login: string } | null;
  body: string;
  createdAt: string;
  replies: {
    nodes: Array<{
      author: { login: string } | null;
      body: string;
      createdAt: string;
    }>;
  };
}

export interface GiscusDiscussion {
  title: string;
  url: string;
  createdAt: string;
  comments: {
    nodes: GiscusComment[];
  };
}

export interface ImportComment {
  id: string;
  slug: string;
  author: string;
  body: string;
  status: string;
  created_at: string;
}

const GRAPHQL_QUERY = `
query($owner: String!, $repo: String!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    discussions(first: 50, after: $cursor, orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes {
        title
        url
        createdAt
        comments(first: 100) {
          nodes {
            author { login }
            body
            createdAt
            replies(first: 100) {
              nodes {
                author { login }
                body
                createdAt
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}`;

/**
 * Fetch all discussions from a GitHub repository via GraphQL.
 * Handles pagination automatically.
 */
export async function fetchGiscusDiscussions(
  owner: string,
  repo: string,
  token: string,
): Promise<GiscusDiscussion[]> {
  const all: GiscusDiscussion[] = [];
  let cursor: string | null = null;

  while (true) {
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "ziscus-migrate",
      },
      body: JSON.stringify({
        query: GRAPHQL_QUERY,
        variables: { owner, repo, cursor },
      }),
    });

    const json = (await res.json()) as {
      data: {
        repository: {
          discussions: {
            nodes: GiscusDiscussion[];
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
          };
        };
      };
    };

    const discussions = json.data.repository.discussions;
    all.push(...discussions.nodes);

    if (!discussions.pageInfo.hasNextPage) break;
    cursor = discussions.pageInfo.endCursor;
  }

  return all;
}

/**
 * Map GitHub Discussions to flat ziscus comments.
 * Threads are flattened with "Re: [parent author]" prefix.
 */
export function mapDiscussionsToComments(discussions: GiscusDiscussion[]): ImportComment[] {
  const comments: ImportComment[] = [];

  for (const disc of discussions) {
    const slug = disc.title;

    for (const comment of disc.comments.nodes) {
      const authorName = comment.author?.login ?? "anonymous";

      comments.push({
        id: randomBytes(8).toString("hex"),
        slug,
        author: authorName,
        body: comment.body,
        status: "approved",
        created_at: comment.createdAt,
      });

      for (const reply of comment.replies.nodes) {
        comments.push({
          id: randomBytes(8).toString("hex"),
          slug,
          author: reply.author?.login ?? "anonymous",
          body: `Re: ${authorName} — ${reply.body}`,
          status: "approved",
          created_at: reply.createdAt,
        });
      }
    }
  }

  return comments;
}

export interface MigrateOptions {
  owner: string;
  repo: string;
  token: string;
  endpoint: string;
  secret: string;
}

/**
 * Run the full migration: fetch from GitHub, map, import to ziscus.
 * Returns the count of imported comments.
 */
export async function runMigrate(opts: MigrateOptions): Promise<number> {
  const discussions = await fetchGiscusDiscussions(opts.owner, opts.repo, opts.token);
  const comments = mapDiscussionsToComments(discussions);

  if (comments.length === 0) return 0;

  const res = await fetch(`${opts.endpoint}/admin/import`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ comments }),
  });

  if (!res.ok) {
    throw new Error(`Import failed (${res.status}): ${await res.text()}`);
  }

  const result = (await res.json()) as { comments: number };
  return result.comments;
}
