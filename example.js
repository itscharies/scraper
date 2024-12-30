import { scrape } from './scraper.js';
import { writeFileSync } from 'node:fs';

(() => {
    scrape('https://www.leagueoflegends.com/en-au/champions/', {
        links: [{
            _scope: '[data-testid="card-grid"] > a[role="button"]',
            href: '{{this | attr(href)}}'
        }]
    }, true).then(async ({ links }) => {

        let pages = links.map(link => 'https://www.leagueoflegends.com' + link.href);

        let data;

        try {
            data = await scrape(pages, {
                name: '{{[data-testid="CharacterMasthead"] [data-testid="title"] | text}}',
                title: '{{[data-testid="CharacterMasthead"] [data-testid="supertitle"] | text}}',
                image: '{{[data-testid="backdrop-background"] > img | attr(src)}}',
                role: '{{[data-testid="roles"] [data-testid="meta-details"] | text | split(/) | trim}}',
                dificulty: '{{[data-testid="difficulty"] [data-testid="meta-details"] | text}}',
            }, true);
        } catch (e) {
            console.log(e);
        }

        writeFileSync(`./champion-data-${Date.now()}.json`, JSON.stringify(data, null, 2));
    });
})()