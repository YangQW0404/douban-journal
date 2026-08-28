// 豆瓣帖子抓取代理（Vercel Serverless Function）
// 作用：带浏览器 UA 抓豆瓣页面，解析出帖子内容 + 全部评论，规避前端 CORS 限制
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function decode(s) {
  if (!s) return '';
  return s.replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”')
    .replace(/&hellip;/g, '…').replace(/&mdash;/g, '—')
    .trim();
}

function extractRe(html, re) {
  const m = html.match(re);
  return m ? decode(m[1]) : '';
}

// 解析单页 HTML 中的评论
function parseComments(html) {
  const comments = [];
  const liRe = /<li[^>]*class="[^"]*comment-item[^"]*"[^>]*>([\s\S]*?)<\/li>/g;
  let m;
  while ((m = liRe.exec(html))) {
    const block = m[1];
    const author = extractRe(block, /<a[^>]*class="[^"]*\bcite[^"]*"[^>]*>([\s\S]*?)<\/a>/) || extractRe(block, /<div[^>]*class="[^"]*\bfrom[^"]*"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/);
    const avatar = (block.match(/<img[^>]*src="([^"]+)"/) || [])[1] || '';
    const time = extractRe(block, /<span[^>]*class="[^"]*\bpubtime[^"]*"[^>]*>([\s\S]*?)<\/span>/);
    const content = extractRe(block, /<div[^>]*class="[^"]*\breply-content[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    let likes = 0;
    // 多种结构匹配：data-votecount / vote count span / likes class
    const vm =
      block.match(/data-votecount="(\d+)"/) ||
      block.match(/class="[^"]*\bvotecount[^"]*"[^>]*>\s*(\d+)\s*</) ||
      block.match(/class="[^"]*\bcomment-vote[^"]*"[^>]*>[\s\S]*?<span[^>]*>\s*(\d+)\s*</) ||
      block.match(/<span[^>]*class="[^"]*\bvote-count[^"]*"[^>]*>\s*(\d+)\s*</) ||
      block.match(/<span[^>]*class="[^"]*\blikes-count[^"]*"[^>]*>\s*(\d+)\s*</) ||
      block.match(/<span[^>]*class="[^"]*\bpraise[^"]*"[^>]*>[\s\S]*?(\d+)[\s\S]*?</) ||
      block.match(/<div[^>]*class="[^"]*\bcomment-votes?[^"]*"[^>]*>[\s\S]*?(\d+)[\s\S]*?</);
    if (vm) likes = +vm[1];
    if (content) comments.push({ author, time, content, avatar, likes });
  }
  return comments;
}

// 可选：在 Vercel 环境变量里配置 DOUBAN_COOKIE（自己浏览器里的豆瓣 Cookie），可解决海外 IP 被风控的问题
const USER_COOKIE = process.env.DOUBAN_COOKIE || '';

async function fetchPage(url) {
  const bid = Math.random().toString(36).slice(2, 14);
  const headers = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Referer': 'https://www.douban.com/',
    'Cookie': USER_COOKIE || ('bid=' + bid)
  };
  const res = await fetch(url, { headers, redirect: 'follow' });
  if (res.status === 403 || res.status === 301) {
    throw new Error('豆瓣拦截了这次请求（服务器 IP 被风控）。请在 Vercel 项目 Settings → Environment Variables 配置 DOUBAN_COOKIE（你浏览器里的豆瓣 Cookie）后重试');
  }
  if (!res.ok) throw new Error(`豆瓣返回 ${res.status}（帖子可能需要登录或已删除）`);
  const html = await res.text();
  if (html.includes('登录豆瓣') && html.length < 3000) throw new Error('该帖子需要登录才能查看');
  return html;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { url, start } = req.query;
  if (!url || !/^https?:\/\/(www\.)?douban\.com\//.test(url)) {
    return res.status(400).json({ error: '请输入 douban.com 的帖子链接' });
  }
  try {
    // 评论分页：豆瓣小组帖子 ?start=0,100,200...
    const target = start !== undefined
      ? url + (url.includes('?') ? '&' : '?') + 'start=' + start
      : url;
    const html = await fetchPage(target);
    const data = { url };
    if (!start) {
      data.title = extractRe(html, /<h1[^>]*>([\s\S]*?)<\/h1>/) || extractRe(html, /<title>([\s\S]*?)<\/title>/);
      data.author = extractRe(html, /<a[^>]*class="[^"]*\bfrom[^"]*"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/) || extractRe(html, /<span[^>]*class="[^"]*\bfrom[^"]*"[^>]*>([\s\S]*?)<\/span>/);
      data.time = extractRe(html, /<span[^>]*class="[^"]*\bcolor-green[^"]*"[^>]*>([\s\S]*?)<\/span>/) || extractRe(html, /class="create-time[^"]*"[^>]*>([\s\S]*?)</);
      data.content = extractRe(html, /<div[^>]*class="[^"]*topic-content[^"]*"[^>]*>([\s\S]*?)<\/div>/) || extractRe(html, /<div[^>]*id="link-report[^"]*"[^>]*>([\s\S]*?)<\/div>/);
      const imgs = [];
      const imgRe = /<div[^>]*class="[^"]*topic-figure[^"]*"[^>]*>\s*<img[^>]*src="([^"]+)"/g;
      let im;
      while ((im = imgRe.exec(html))) imgs.push(im[1]);
      data.images = imgs;
      data.topicId = (url.match(/topic\/(\d+)/) || [])[1] || '';
    }
    data.comments = parseComments(html);
    // 总评论数（豆瓣小组帖子显示 "共 xxx 条回复"）
    if (!start) {
      const tm = html.match(/共\s*(\d+)\s*条回复/) || html.match(/(\d+)\s*条回复/);
      data.totalComments = tm ? +tm[1] : (data.comments ? data.comments.length : 0);
    }
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ error: e.message || '抓取失败' });
  }
}
