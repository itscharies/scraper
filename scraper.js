import got from "got";
import * as cheerio from "cheerio";
import puppeteer from "puppeteer";

import _ from "lodash";
const { isArray, isFunction, isPlainObject, isString } = _;

const globalFilters = {
  text: (val) => val.text(),
  html: (val) => val.html(),
  trim: (val) =>
    isArray(val)
      ? val.map((v) => v.trim())
      : val.trim(),
  split: (val, ...params) => val.split(...params),
  join: (val, ...params) => val.join(...params),
  replace: (val, ...params) => val.replace(...params),
  removeEmpty: (val, ...params) => val.removeEmpty(...params),
  removeDeep: (val, ...params) => val.removeDeep(...params),
  prop: (val, ...params) => val.prop(...params),
  number: (val) => +val,
  lowercase: (val) => val.toLowerCase(),
  uppercase: (val) => val.toUpperCase(),
  attr: (val, ...params) => val.attr(...params),
};

// Expose any additional helpers on the cheerio prototype
const extendCheerio = ($) => {
  // Get the outer html element
  $.prototype.outerHTML = function () {
    return $.html(this);
  };

  // Loops through the items in a cheerio each function
  // Uses a 'for of' loop in order to allow for async/await use within the callback function
  $.prototype.eachSync = async function (callback) {
    const items = [];

    this.each((i, el) => {
      items.push({
        i,
        el,
      });
    });

    for (let { i, el } of items) {
      await callback(i, el);
    }
  };

  /**
   * Extends the default cheerio css with a safeguard for when the element is undefined
   * @param params
   * @returns {Boolean}
   */
  $.prototype.safeCSS = function (...params) {
    return this.length ? this.css(...params) : null;
  };

  /**
   * Determines whether an element has ALL the classes passed to it as arguments
   * @param classes
   * @returns {Boolean}
   */
  $.prototype.hasClasses = function (...classes) {
    return classes.map((cls) => this.hasClass(cls)).indexOf(false) === -1;
  };

  /**
   * Determines whether an element has ONE of the classes passed to it as arguments
   * @param classes
   * @returns {Boolean}
   */
  $.prototype.hasOneOfClasses = function (...classes) {
    return classes.map((cls) => this.hasClass(cls)).indexOf(true) !== -1;
  };

  /**
   * Performs a deep removal like JQuery's remove(:selector) does
   * @param selectors
   * @returns {*}
   */
  $.prototype.removeDeep = function (...selectors) {
    return selectors.map((selector) => {
      selector = selector || "*";
      return this.find(selector).remove();
    });
  };

  /**
   * Remove all empty elements
   * @param selectors
   * @returns {*}
   */
  $.prototype.removeEmpty = function (...selectors) {
    return selectors.map((selector) => {
      selector = selector || "*";
      return this.find(selector)
        .filter(function () {
          return !$(this).text().trim() && this.name !== "br";
        })
        .remove();
    });
  };

  /**
   * Replaces a classname with another
   * @param oldClass {String} One or more classes to replace
   * @param newClass {String} One or more classes to replace with
   * @returns {$}
   */
  $.prototype.replaceClass = function (oldClass, newClass) {
    this.find(`.${oldClass}`).removeClass(oldClass).addClass(newClass);
    return this;
  };
};

/**
 * Resolve expressions given a string value
 *
 * @param {*} $scope
 * @param {*} expressions
 * @param {*} value
 */
const resolveExpressions = ($scope, expressions, value) => {
  let resolved = value;

  // Loop through each expression
  expressions.forEach((exp) => {
    // Determine the key to be resolved on the provided object by removing curly braces {{}}
    let resolveKey = exp.replace(/{{|}}/g, "");

    const filters = resolveKey.split("|").map((f) => f.trim());
    const query = filters.shift().trim(); // remove the non filter portion;

    // Determine how to handle the cheerio query based on the current scope
    const $el = query && query !== "this" ? $scope.find(query) : $scope;

    let result = $el;

    filters.forEach((filter) => {
      let key, params;

      if (filter.match(/[a-z]?\(.*\)/i)) {
        let parts = filter.split("(");
        key = parts[0];
        parts[1] = parts[1].substr(0, parts[1].length - 1);
        params = parts[1].split(",");
      } else {
        key = filter;
        params = [];
      }

      try {
        result = globalFilters[key](result, ...params);
      } catch (e) {
        console.error(e);
      }
    });

    if (exp === value) {
      resolved = result;
    } else {
      resolved = resolved.replace(exp, result);
    }
  });

  return resolved;
};

/**
 * Resolves a mapping based on the type of value that is provided
 *
 * @param value
 * @param $
 * @returns {Promise<*>}
 */
const resolveMappingType = async (value, $scope) => {
  // String values
  if (isString(value)) {
    let resolved;
    // Try and match any expressions that may be present in a provided string value, so that they can be resolved
    // e.g. 'Name: {{name}}'
    const expressions = value.match(/{{.*?}}/gi);

    // If any matching expressions have been found try and resolve them
    if (expressions) {
      resolved = resolveExpressions($scope, expressions, value);
    } else {
      resolved = value;
    }

    // Return the resolved string
    return resolved;
  } else if (isFunction(value)) {
    // If the value provided is a function call it with the source object passed as the first parameter
    if (value.constructor.name === "AsyncFunction") {
      // If our function is an asynchronous one, prepend await to the function call
      return await value($scope);
    } else {
      return value($scope);
    }
  } else {
    // For all other values simply return what is provided
    return value;
  }
};

/**
 * Resolves the mappings in each item of schema
 *
 * @param {*} $
 * @param {*} schema
 * @param {*} result
 * @param {*} i
 */
const resolveSchema = async ($scope, schema, result, i) => {
  // Loop through our array
  for (let key of Object.keys(schema)) {
    if (key === "_scope") continue;

    // Get the current item
    const value = schema[key];

    if (isArray(value) || isPlainObject(value)) {
      // If our item is an object or array, call this function again recursively
      result[i || key] = await mapObject($scope, value);
    } else {
      // Otherwise resolve the mapping based on the type of data that is provided
      result[i || key] = await resolveMappingType(value, $scope);
    }
  }
};

/**
 * A function that is run for the objects to be mapped
 * @param $
 * @param schema
 * @returns {Promise<{}>}
 */
const mapObject = async ($scope, schema) => {
  let result;

  // Our resulting data must always match the initial type that is provided in the schema
  if (isArray(schema) && schema[0]._scope) {
    result = [];

    const $els = [];
    $scope.find(schema[0]._scope).each((i, el) => {
      $els.push({ $el: $scope.find(el), i });
    });

    for (let { $el, i } of $els) {
      await resolveSchema($el, schema, result, i);
    }
  } else if (isArray(schema)) {
    result = new Array(schema.length);
    await resolveSchema($scope, schema, result);
  } else {
    result = {};
    await resolveSchema($scope, schema, result);
  }

  // Return the mapped result
  return result;
};

/**
 * Scrapes a URL or many URLS to the shape of a provided schema
 * @param {string | string[]} urls 
 * @param {Object} schema 
 * @param {boolean} requireBrowser 
 * @returns 
 */
export async function scrape(urls, schema, requireBrowser = false) {
  if (isArray(urls)) {
    return scrapePages(urls, schema, requireBrowser);
  } else {
    return scrapePage(urls, schema, requireBrowser);
  }
}

/**
 * Scrapes a URL
 * @param {string} urls 
 * @param {Object} schema 
 * @param {boolean} requireBrowser 
 * @returns 
 */
async function scrapePage(url, schema, requireBrowser = false) {
  let body, browser;

  console.log(`[${requireBrowser ? 'BROWSER' : 'RAW-HTML'}] Scraping page: ${url}`);
  if (requireBrowser) {
    // Launch the headless browser with configuration to run on node:8-alpine
    browser = await puppeteer
      .launch({
        args: ["--disable-dev-shm-usage", "--no-sandbox"],
        executablePath: process.env.PUPPETEER_EXEC_PATH || undefined,
      })
      .catch((e) => logger.error(e));

    // Create a new page and go to the url and wait for the network idle
    const page = await browser.newPage();

    page.on("error", (e) => {
      logger.error(e);
    });

    // Resolve page and wait until there are no more than 2 network requests for more than 500ms
    await page.goto(url, { waitUntil: "networkidle2", timeout: 180000 });
    body = await page.evaluate(
      () => document.head.innerHTML + document.body.innerHTML
    );
    await browser.close();
  } else {
    const page = await got(url);
    body = page.body;
  }

  const $ = cheerio.load(body);

  extendCheerio($);

  return mapObject($("html"), schema);
}

/**
 * Scrapes a list of urls
 * @param {string[]} urls 
 * @param {Object} schema 
 * @param {boolean} requireBrowser 
 * @returns 
 */
async function scrapePages(urls, schema, requireBrowser) {
  if (!requireBrowser) {
    return Promise.all(urls.map((url) => scrape(url, schema, requireBrowser)));
  }

  let data = [];
  for (let url of urls) {
    data.push(await scrape(url, schema, requireBrowser));
  }
  return data;
}

/**
 * @deprecated You should probably just make a list of links and run scrapePages :lol:
 * @param {*} url
 * @param {*} schema
 * @param {*} total
 * @param {*} requireBrowser
 * @returns
 */
async function scrapePagination(url, schema, total, requireBrowser) {
  let pages = [];

  if (typeof total === "number") {
    for (let i = 1; i <= total; i++) {
      pages.push(i);
    }
  } else {
    pages = total;
  }

  return Promise.all(
    pages.map((page) =>
      scrape(url.replace("{page}", page), schema, requireBrowser)
    )
  );
}
