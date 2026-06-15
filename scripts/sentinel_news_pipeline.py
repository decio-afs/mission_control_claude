import urllib.request
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from datetime import datetime

# Cache directory for Sentinel output — lives inside the Mission Control project
# data dir (.mc/cache/sentinel), the same location the bridge's SENTINEL_CACHE_DIR
# points at. Self-contained: no dependency on any external tool's home directory.
CACHE_DIR = Path(__file__).resolve().parent.parent / ".mc" / "cache" / "sentinel"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

def get_today_cache_path():
    today = datetime.now().strftime("%Y-%m-%d")
    return CACHE_DIR / f"digest_{today}.json"

def load_cached_digest():
    cache_path = get_today_cache_path()
    if cache_path.exists():
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None
    return None

def save_digest_cache(data):
    cache_path = get_today_cache_path()
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    # Also save as latest.json for easy access
    latest_path = CACHE_DIR / "latest.json"
    with open(latest_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def get_archive_digests(limit=30):
    """Return list of past digest metadata."""
    digests = []
    for f in sorted(CACHE_DIR.glob("digest_*.json"), reverse=True):
        date_str = f.stem.replace("digest_", "")
        try:
            stat = f.stat()
            digests.append({
                "date": date_str,
                "path": str(f),
                "size": stat.st_size,
                "modified": datetime.fromtimestamp(stat.st_mtime).isoformat()
            })
        except Exception:
            continue
    return digests[:limit]

def fetch_hn_trends():
    print("[Sentinel] Fetching Hacker News Top Stories...")
    hn_top_url = "https://hacker-news.firebaseio.com/v0/topstories.json"
    try:
        req = urllib.request.Request(hn_top_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req) as response:
            top_ids = json.loads(response.read().decode())[:100]

        relevant_stories = []
        keywords = ["ai", "llm", "agent", "automation", "next.js", "nextjs", "vercel", "aws", "web", "react", "scrape", "gpu", "rag", "anthropic", "openai", "claude", "chatgpt"]

        for story_id in top_ids:
            if len(relevant_stories) >= 8:
                break
            story_url = f"https://hacker-news.firebaseio.com/v0/item/{story_id}.json"
            try:
                with urllib.request.urlopen(urllib.request.Request(story_url, headers={"User-Agent": "Mozilla/5.0"})) as r:
                    story = json.loads(r.read().decode())
                title = story.get("title", "")
                title_lower = title.lower()
                if any(kw in title_lower for kw in keywords):
                    relevant_stories.append({
                        "title": title,
                        "url": story.get("url", f"https://news.ycombinator.com/item?id={story_id}"),
                        "source": "Hacker News",
                        "score": story.get("score", 0)
                    })
            except Exception:
                continue
        return relevant_stories
    except Exception as e:
        print("[Sentinel] HN Fetch Error:", e)
        return []

def fetch_reddit_trends(subreddit):
    print(f"[Sentinel] Fetching r/{subreddit} Trends...")
    url = f"https://www.reddit.com/r/{subreddit}/hot.json?limit=15"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sentinel/1.0"})
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode())
            posts = data.get("data", {}).get("children", [])

        trends = []
        for post in posts:
            pdata = post.get("data", {})
            if pdata.get("is_self") or pdata.get("url"):
                if not pdata.get("stickied"):
                    trends.append({
                        "title": pdata.get("title", ""),
                        "url": pdata.get("url", f"https://reddit.com{pdata.get('permalink', '')}"),
                        "source": f"r/{subreddit}",
                        "score": pdata.get("ups", 0)
                    })
            if len(trends) >= 4:
                break
        return trends
    except Exception as e:
        print(f"[Sentinel] Reddit r/{subreddit} Fetch Error:", e)
        return []

def fetch_rss_trends(feed_url, source_name):
    print(f"[Sentinel] Fetching {source_name} RSS...")
    try:
        req = urllib.request.Request(feed_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req) as response:
            xml_data = response.read()
        root = ET.fromstring(xml_data)

        items = []
        for item in root.findall(".//item")[:5]:
            title = item.find("title")
            link = item.find("link")
            title_text = title.text if title is not None else ""
            link_text = link.text if link is not None else ""
            items.append({
                "title": title_text,
                "url": link_text,
                "source": source_name,
                "score": "N/A"
            })
        return items
    except Exception as e:
        print(f"[Sentinel] RSS {source_name} Fetch Error:", e)
        return []

def fetch_google_news_trends():
    print("[Sentinel] Fetching Google News Trends (AI & Web Dev)...")
    url = "https://news.google.com/rss/search?q=ai+automation+OR+nextjs+OR+vercel&hl=en-US&gl=US&ceid=US:en"
    return fetch_rss_trends(url, "Google News")

def build_and_cache_digest(
    hn_stories, localllama_stories, webdev_stories,
    singularity_stories, nextjs_stories,
    techcrunch_stories, vercel_stories, openai_stories, google_stories
):
    all_trends = (hn_stories + localllama_stories + webdev_stories +
                  singularity_stories + nextjs_stories +
                  techcrunch_stories + vercel_stories + openai_stories + google_stories)

    # Deduplicate
    seen_links = set()
    deduped_trends = []
    for story in all_trends:
        link = story["url"]
        if link not in seen_links:
            seen_links.add(link)
            deduped_trends.append(story)

    digest = {
        "generated_at": datetime.now().isoformat(),
        "total_stories": len(deduped_trends),
        "sources": list(set(s["source"] for s in deduped_trends)),
        "stories": deduped_trends
    }

    # Cache the structured digest
    save_digest_cache(digest)

    print("\n" + "="*50)
    print("📢 SENTINEL TRENDS DATA INGESTION OUTPUT")
    print("="*50 + "\n")

    if not deduped_trends:
        print("No rising trends detected today.")
        return

    for i, story in enumerate(deduped_trends, 1):
        print(f"[{i}] Title: {story['title']}")
        print(f"    Source: {story['source']} | Score/Engagement: {story['score']}")
        print(f"    Link: {story['url']}\n")

    print(f"✅ Cached {len(deduped_trends)} stories to {get_today_cache_path()}")

def main():
    # Check if today's digest already exists
    cached = load_cached_digest()
    if cached:
        print(f"[Sentinel] Today's digest already cached ({cached['total_stories']} stories). Use --force to refresh.")
        return

    hn_stories = fetch_hn_trends()
    localllama_stories = fetch_reddit_trends("LocalLLaMA")
    webdev_stories = fetch_reddit_trends("webdev")
    singularity_stories = fetch_reddit_trends("singularity")
    nextjs_stories = fetch_reddit_trends("nextjs")

    # Official Release / Tech Blogs RSS
    techcrunch_stories = fetch_rss_trends("https://techcrunch.com/category/artificial-intelligence/feed/", "TechCrunch AI")
    vercel_stories = fetch_rss_trends("https://vercel.com/blog/feed", "Vercel Blog")
    openai_stories = fetch_rss_trends("https://openai.com/news/rss.xml", "OpenAI Blog")

    # Google News
    google_stories = fetch_google_news_trends()

    build_and_cache_digest(
        hn_stories, localllama_stories, webdev_stories,
        singularity_stories, nextjs_stories,
        techcrunch_stories, vercel_stories, openai_stories, google_stories
    )

if __name__ == "__main__":
    import sys
    if "--force" in sys.argv:
        # Skip cache check
        hn_stories = fetch_hn_trends()
        localllama_stories = fetch_reddit_trends("LocalLLaMA")
        webdev_stories = fetch_reddit_trends("webdev")
        singularity_stories = fetch_reddit_trends("singularity")
        nextjs_stories = fetch_reddit_trends("nextjs")
        techcrunch_stories = fetch_rss_trends("https://techcrunch.com/category/artificial-intelligence/feed/", "TechCrunch AI")
        vercel_stories = fetch_rss_trends("https://vercel.com/blog/feed", "Vercel Blog")
        openai_stories = fetch_rss_trends("https://openai.com/news/rss.xml", "OpenAI Blog")
        google_stories = fetch_google_news_trends()
        build_and_cache_digest(
            hn_stories, localllama_stories, webdev_stories,
            singularity_stories, nextjs_stories,
            techcrunch_stories, vercel_stories, openai_stories, google_stories
        )
    else:
        main()
