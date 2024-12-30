## Scraper

```
const data = await scrape('https:/mywebsite.com', {
    title: '{{h1 > span | text}}',
    desc: '{{h2 | text | trim}}',
});

// into...

{
    title: "Hello!",
    desc: "My cool website.\nHow are you?"
}
```