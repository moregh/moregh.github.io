/*
    EVE Target Intel - DOM Element Cache Utility

    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

class DOMCache {
    constructor() {
        this.cache = new Map();
    }

    get(id) {
        if (!this.cache.has(id)) {
            const element = document.getElementById(id);
            if (element) {
                this.cache.set(id, element);
            }
        }
        return this.cache.get(id) || null;
    }

    query(selector) {
        if (!this.cache.has(selector)) {
            const element = document.querySelector(selector);
            if (element) {
                this.cache.set(selector, element);
            }
        }
        return this.cache.get(selector) || null;
    }

    queryAll(selector) {
        return document.querySelectorAll(selector);
    }

    clear() {
        this.cache.clear();
    }
}

export const domCache = new DOMCache();
