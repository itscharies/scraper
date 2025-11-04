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

Run the script with
```
deno -A example.js
```

Some things to note:
- The input schema is used to shape the output data 
- Arrays are treated as fixed length unless they include an object with a `_scope` key (maybe I should change this).