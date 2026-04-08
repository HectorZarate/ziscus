import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  fetchGiscusDiscussions,
  mapDiscussionsToComments,
  type GiscusDiscussion,
  type GiscusComment as GiscusReply,
} from "./migrate.js";

const SAMPLE_DISCUSSIONS: GiscusDiscussion[] = [
  {
    title: "post-a",
    url: "https://github.com/owner/repo/discussions/1",
    createdAt: "2026-01-15T10:00:00Z",
    comments: {
      nodes: [
        {
          author: { login: "alice" },
          body: "Great post!",
          createdAt: "2026-01-15T11:00:00Z",
          replies: {
            nodes: [
              {
                author: { login: "bob" },
                body: "I agree with Alice",
                createdAt: "2026-01-15T12:00:00Z",
              },
            ],
          },
        },
        {
          author: { login: "charlie" },
          body: "Interesting take",
          createdAt: "2026-01-15T13:00:00Z",
          replies: { nodes: [] },
        },
      ],
    },
  },
  {
    title: "post-b",
    url: "https://github.com/owner/repo/discussions/2",
    createdAt: "2026-02-01T10:00:00Z",
    comments: {
      nodes: [],
    },
  },
];

describe("mapDiscussionsToComments", () => {
  it("maps top-level comments with discussion title as slug", () => {
    const comments = mapDiscussionsToComments(SAMPLE_DISCUSSIONS);
    const topLevel = comments.filter((c) => !c.body.startsWith("Re:"));
    expect(topLevel).toHaveLength(2);
    expect(topLevel[0]!.slug).toBe("post-a");
    expect(topLevel[0]!.author).toBe("alice");
    expect(topLevel[0]!.body).toBe("Great post!");
  });

  it("flattens replies with Re: prefix", () => {
    const comments = mapDiscussionsToComments(SAMPLE_DISCUSSIONS);
    const replies = comments.filter((c) => c.body.startsWith("Re:"));
    expect(replies).toHaveLength(1);
    expect(replies[0]!.body).toBe("Re: alice — I agree with Alice");
    expect(replies[0]!.author).toBe("bob");
    expect(replies[0]!.slug).toBe("post-a");
  });

  it("preserves timestamps", () => {
    const comments = mapDiscussionsToComments(SAMPLE_DISCUSSIONS);
    expect(comments[0]!.created_at).toBe("2026-01-15T11:00:00Z");
  });

  it("sets status to approved for all imported comments", () => {
    const comments = mapDiscussionsToComments(SAMPLE_DISCUSSIONS);
    expect(comments.every((c) => c.status === "approved")).toBe(true);
  });

  it("skips discussions with no comments", () => {
    const comments = mapDiscussionsToComments(SAMPLE_DISCUSSIONS);
    const postB = comments.filter((c) => c.slug === "post-b");
    expect(postB).toHaveLength(0);
  });

  it("generates unique IDs for each comment", () => {
    const comments = mapDiscussionsToComments(SAMPLE_DISCUSSIONS);
    const ids = comments.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("handles null author gracefully", () => {
    const discussions: GiscusDiscussion[] = [{
      title: "test",
      url: "https://github.com/owner/repo/discussions/3",
      createdAt: "2026-03-01T00:00:00Z",
      comments: {
        nodes: [{
          author: null,
          body: "Anonymous comment",
          createdAt: "2026-03-01T01:00:00Z",
          replies: { nodes: [] },
        }],
      },
    }];
    const comments = mapDiscussionsToComments(discussions);
    expect(comments[0]!.author).toBe("anonymous");
  });
});

describe("fetchGiscusDiscussions", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        data: {
          repository: {
            discussions: {
              nodes: SAMPLE_DISCUSSIONS,
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      })),
    ));
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it("fetches discussions from GitHub GraphQL API", async () => {
    const result = await fetchGiscusDiscussions("owner", "repo", "ghp_token");
    expect(result).toHaveLength(2);
    expect(result[0]!.title).toBe("post-a");
  });

  it("sends Authorization header with token", async () => {
    await fetchGiscusDiscussions("owner", "repo", "ghp_token");
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].headers.Authorization).toBe("bearer ghp_token");
  });

  it("queries the correct repository", async () => {
    await fetchGiscusDiscussions("myowner", "myrepo", "ghp_token");
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.variables.owner).toBe("myowner");
    expect(body.variables.repo).toBe("myrepo");
  });

  it("handles pagination", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { repository: { discussions: {
          nodes: [SAMPLE_DISCUSSIONS[0]],
          pageInfo: { hasNextPage: true, endCursor: "cursor1" },
        } } },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { repository: { discussions: {
          nodes: [SAMPLE_DISCUSSIONS[1]],
          pageInfo: { hasNextPage: false, endCursor: null },
        } } },
      })));
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchGiscusDiscussions("owner", "repo", "ghp_token");
    expect(result).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
