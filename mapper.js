const { get, isArray, isFunction, isPlainObject, isString } = require('lodash');

/**
 * Resolves a mapping based on the type of value that is provided
 *
 * @param value
 * @param obj
 * @returns {Promise<*>}
 */
const resolveMappingType = async (value, obj) => {
    // String values
    if (isString(value)) {
        // Try and match any expressions that may be present in a provided string value, so that they can be resolved
        // e.g. 'Mr. {{name}}'
        const expressions = value.match(/__~?(([_$a-z][_$a-z0-9]*?)|(\[([0-9]+|'.+?'|".+?")]))(\.([_$a-z][_$a-z0-9]*?)|(\[([0-9]+|'.+?'|".+?")]))*?__/ig);
        let resolved = value;

        // If any matching expressions have been found try and resolve them
        if (expressions) {
            // Loop through each expression
            expressions.forEach(exp => {
                // Determine the key to be resolved on the provided object by removing curly braces {{}}
                let resolveKey = exp.replace(/__|__/g, '');
                // Resolve the value as a string by prepending a tilde '~'
                // e.g. {{~items.length}}
                let resolveAsString = resolveKey.startsWith('~');

                // If the expression is the only value provided, resolve the value as is preserving the type
                // e.g. '{{items}}' for an array will resolve the value to an array
                //      '{{items.length}}' will resolve the value to a number
                //      '{{~items.length}}' will resolve the value to a string by the tilde (~) provided at the start
                if (exp === value && !resolveAsString) {
                    // As there is only one value, return the resolved value
                    return resolved = get(obj, resolveKey);
                }

                if (resolveAsString) {
                    // trim the first character (~) so we can get the correct key
                    resolveKey = resolveKey.substring(1);
                }

                // Other wise replace the expression with the resolved value
                // If more than one value is found in an expression it will always resolve as a string
                // If you wish to combine or modify more than one value of an object into a single field consider using a function instead
                resolved = resolved.replace(exp, get(obj, resolveKey));
            });
        }

        // Return the resolved string
        return resolved;
    } else if (isFunction(value)) {
        // If the value provided is a function call it with the source object passed as the first parameter
        if (value.constructor.name === "AsyncFunction") {
            // If our function is an asynchronous one, prepend await to the function call
            return await value(obj);
        } else {
            return value(obj);
        }
    } else {
        // For all other values simply return what is provided
        return value;
    }
};

/**
 * A function that is run for the objects to be mapped
 * @param obj
 * @param schema
 * @returns {Promise<{}>}
 */
const mapObject = async (obj, schema) => {
    let result;

    // Our resulting data must always match the initial type that is provided in the schema
    if (isArray(schema)) {
        result = new Array(schema.length);
    } else {
        result = {};
    }

    // Loop through our array
    for (let key of Object.keys(schema)) {
        // Get the current item
        const value = schema[key];

        if (isArray(value) || isPlainObject(value)) {
            // If our item is an object of array call this function again recursively
            result[key] = await mapObject(obj, value);
        } else {
            // Otherwise resolve the mapping based on the type of data that is provided
            result[key] = await resolveMappingType(value, obj);
        }
    }

    // Return the mapped result
    return result;
};

/**
 * A maps object and arrays of objects to a provided schema
 *
 * A schema consists of an object or array that models what the data should look like when mapped. It is defined
 * when initialising a new Mapper. Each key corresponds to the outputted object structure and each value defines
 * the value that will be assigned.
 *
 * These values can be of 3 types:
 *  - Strings
 *  - Functions
 *  - Objects (and arrays)
 *
 *  Strings: Are resolved as is. If a string contains expressions in curly braces e.g. '{{name}}' it will attempt
 *           to resolve the key 'name' in the srcObject that it is mapping
 *
 *  Functions: Will call this function when attempting to first argument passed to the function is the srcObject.
 *             The value returned by the function is what will be resolved to the mapped option
 *
 *  Objects (and arrays): Are used to structure the data how you want it. The items of an object or array will then be
 *                        processed normally based on their type (String, Function or Object/Array) and will recursively
 *                        map each item until the entire schema has been traversed.
 *
 * e.g. {
 *   origin: 'Manufacturer',
 *   id: '{{id}}',
 *   make: '{{make}}',
 *   name: '{{name}}',
 *   code: '#{{code}}',
 *   totalPrice: (srcObject) => items.reduce((total, item) => total + item.price, 0),
 *   count: '{{items.length}}',
 *   price: {
 *      extGst: (srcObject) => srcObject.price * 0.9,
 *      incGst: '{{price}}',
 *      label: '${{price}}'
 *   }
 * }
 */
export class Mapper {
    /**
     * Initialise our mapper
     * @param schema A schema that will be used when mapping
     */
    constructor(schema) {
        this.schema = schema;
    }

    /**
     * Function to map a single object with the provided schema
     * @param obj
     * @returns {Promise<*>}
     */
    async map(obj) {
        return await mapObject(obj, this.schema);
    }

    /**
     * A function to map a list of objects with the provided schema
     * @param list
     * @returns {Promise<[]>}
     */
    async mapList(list) {
        const result = new Array(list.length);

        // Loop through the items in out list and mapped each one
        for (let index of Object.keys(list)) {
            result[index] = await mapObject(list[index], this.schema);
        }

        return result;
    }
}