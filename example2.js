import { scrape, paginate } from './scraper.js';
import { writeFileSync } from 'node:fs';

(async () => {
    const { count } = await scrape('https://letterboxd.com/charies/films/diary', { count: '{{.paginate-pages li.paginate-page:last-child | text | num}}' })
    scrape(paginate('https://letterboxd.com/charies/films/diary/page/{i}/', count), [{
        _scope: 'tr[data-object-name="entry"]',
        title: '{{td.td-film-details h3.headline-3 | text}}',
        year: '{{td.td-released | text}}',
        rating: '{{td.td-rating .rating | text | trim}}'
    }]
    ).then((data) => {
        writeFileSync(`./letterboxed-data-${Date.now()}.json`, JSON.stringify(data.flat(), null, 2));
    })
})()