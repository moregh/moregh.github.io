/*
    EVE Target Intel - Intersection Observer Management
    
    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

import {
    PERFORMANCE_CONFIG,
    MAX_CONCURRENT_IMAGES,
    IMAGE_OBSERVER_THRESHOLD,
    IMAGE_OBSERVER_ROOT_MARGIN,
    IMAGE_OPACITY_LOADING,
    IMAGE_OPACITY_ERROR,
    IMAGE_OPACITY_LOADED,
    SCROLL_DETECTION_TIME_MS,
    CONCURRENT_IMAGE_LOAD_DIVISOR
} from './config.js';

export class ManagedObservers {
    constructor() {
        this.imageObserver = null;
        this.animationObserver = null;
        this.observedImages = new Set();
        this.observedAnimations = new Set();
        this.pendingImageObservations = [];
        this.pendingAnimationObservations = [];
        this.batchTimeout = null;
    }

    getImageObserver() {
        if (!this.imageObserver) {
            this.imageObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        if (img.dataset.src && !img.src.startsWith('https://') && document.contains(img)) {
                            img.dataset.loading = 'true';
                            imageLoadQueue.push(img);
                            this.imageObserver.unobserve(img);
                            this.observedImages.delete(img);
                            this.scheduleImageProcessing();
                        }
                    }
                });
            }, {
                rootMargin: IMAGE_OBSERVER_ROOT_MARGIN,
                threshold: IMAGE_OBSERVER_THRESHOLD
            });
        }
        return this.imageObserver;
    }

    scheduleImageProcessing() {
        if (this.imageProcessingTimeout) return;

        const runner = () => {
            processImageQueue();
            this.imageProcessingTimeout = null;
        };

        if (typeof requestAnimationFrame === 'function') {
            this.imageProcessingTimeout = requestAnimationFrame(runner);
        } else {
            this.imageProcessingTimeout = setTimeout(runner, 16);
        }
    }

    getAnimationObserver() {
        if (!this.animationObserver) {
            this.animationObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting && document.contains(entry.target)) {
                        entry.target.classList.add('animate-in');
                        this.animationObserver.unobserve(entry.target);
                        this.observedAnimations.delete(entry.target);
                    }
                });
            }, {
                rootMargin: PERFORMANCE_CONFIG.ANIMATION_INTERSECTION_MARGIN,
                threshold: 0.01
            });
        }
        return this.animationObserver;
    }

    observeImage(img) {
        if (!img || this.observedImages.has(img) || !document.contains(img)) return;

        this.pendingImageObservations.push(img);
        this.scheduleBatchProcess();
    }

    observeAnimation(element) {
        if (!element || this.observedAnimations.has(element) || !document.contains(element)) return;

        this.pendingAnimationObservations.push(element);
        this.scheduleBatchProcess();
    }

    scheduleBatchProcess() {
        if (this.batchTimeout) return;

        const runner = () => {
            this.processBatches();
            this.batchTimeout = null;
        };

        if (typeof requestAnimationFrame === 'function') {
            this.batchTimeout = requestAnimationFrame(runner);
        } else {
            this.batchTimeout = setTimeout(runner, 16);
        }
    }

    processBatches() {
        const batchSize = Math.max(1, Math.floor(Number(PERFORMANCE_CONFIG.BATCH_SIZE) || 1));
        const imageBatches = this.chunkArray(this.pendingImageObservations, batchSize);

        imageBatches.forEach(batch => {
            batch.forEach(img => {
                if (document.contains(img) && !this.observedImages.has(img)) {
                    try {
                        this.getImageObserver().observe(img);
                        this.observedImages.add(img);
                    } catch (error) {
                        console.warn('Failed to observe image:', error);
                    }
                }
            });
        });

    const animationBatches = this.chunkArray(this.pendingAnimationObservations, batchSize);
        animationBatches.forEach(batch => {
            batch.forEach(element => {
                if (document.contains(element) && !this.observedAnimations.has(element)) {
                    try {
                        this.getAnimationObserver().observe(element);
                        this.observedAnimations.add(element);
                    } catch (error) {
                        console.warn('Failed to observe animation element:', error);
                    }
                }
            });
        });

        this.pendingImageObservations = [];
        this.pendingAnimationObservations = [];
    }

    chunkArray(array, chunkSize) {
        const chunks = [];
        const size = Math.max(1, Math.floor(Number(chunkSize) || 1));
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    cleanup() {
        if (this.batchTimeout) {
            try { cancelAnimationFrame(this.batchTimeout); } catch(e) { clearTimeout(this.batchTimeout); }
            this.batchTimeout = null;
        }

        if (this.imageProcessingTimeout) {
            try { cancelAnimationFrame(this.imageProcessingTimeout); } catch(e) { clearTimeout(this.imageProcessingTimeout); }
            this.imageProcessingTimeout = null;
        }

        this.pendingImageObservations = [];
        this.pendingAnimationObservations = [];

        this.observedImages.forEach(img => {
            try { if (this.imageObserver && typeof this.imageObserver.unobserve === 'function') this.imageObserver.unobserve(img); } catch (e) { }
        });
        this.observedAnimations.forEach(element => {
            try { if (this.animationObserver && typeof this.animationObserver.unobserve === 'function') this.animationObserver.unobserve(element); } catch (e) { }
        });

        try { this.imageObserver?.disconnect(); } catch (e) { }
        try { this.animationObserver?.disconnect(); } catch (e) { }
        this.imageObserver = null;
        this.animationObserver = null;
        this.observedImages.clear();
        this.observedAnimations.clear();

        imageLoadQueue = [];
        priorityImageQueue = [];
    }

    cleanupDeadElements() {
        for (const img of Array.from(this.observedImages)) {
            try {
                if (!document.contains(img)) {
                    if (this.imageObserver && typeof this.imageObserver.unobserve === 'function') {
                        this.imageObserver.unobserve(img);
                    }
                    this.observedImages.delete(img);
                }
            } catch (e) {
                this.observedImages.delete(img);
            }
        }

        for (const element of Array.from(this.observedAnimations)) {
            try {
                if (!document.contains(element)) {
                    if (this.animationObserver && typeof this.animationObserver.unobserve === 'function') {
                        this.animationObserver.unobserve(element);
                    }
                    this.observedAnimations.delete(element);
                }
            } catch (e) {
                this.observedAnimations.delete(element);
            }
        }
    }

    // Lightweight GC to prune observed sets periodically
    performPeriodicCleanup() {
        try {
            this.cleanupDeadElements();
        } catch (e) {
            // ignore
        }
    }
}

let imageLoadQueue = [];
let priorityImageQueue = [];
let currentlyLoading = 0;
let imageObserverEnabled = true;
let lastScrollTime = 0;

export function processImageQueue() {
    const now = Date.now();
    const isScrolling = (now - lastScrollTime) < SCROLL_DETECTION_TIME_MS;

    while (priorityImageQueue.length > 0 && currentlyLoading < MAX_CONCURRENT_IMAGES && imageObserverEnabled) {
        const img = priorityImageQueue.shift();
        if (img && img.dataset.src && document.contains(img) && !img.src.startsWith('https://')) {
            loadSingleImage(img);
        }
    }

    const maxConcurrent = isScrolling ? Math.max(1, MAX_CONCURRENT_IMAGES / CONCURRENT_IMAGE_LOAD_DIVISOR) : MAX_CONCURRENT_IMAGES;

    while (imageLoadQueue.length > 0 && currentlyLoading < maxConcurrent && imageObserverEnabled) {
        const img = imageLoadQueue.shift();
        if (img && img.dataset.src && document.contains(img) && !img.src.startsWith('https://')) {
            loadSingleImage(img);
        }
    }
}

function trackScrollState() {
    lastScrollTime = Date.now();
}

if (typeof window !== 'undefined') {
    window.addEventListener('scroll', trackScrollState, { passive: true });
}

function loadSingleImage(img) {
    const realSrc = img.dataset.src;
    if (!realSrc || img.src === realSrc) return;

    currentlyLoading++;
    img.style.opacity = IMAGE_OPACITY_LOADING;

    const onLoad = () => {
        currentlyLoading--;
        img.style.opacity = IMAGE_OPACITY_LOADED;
        img.removeEventListener('load', onLoad);
        img.removeEventListener('error', onError);
        delete img.dataset.loading;

        requestAnimationFrame(() => processImageQueue());
    };

    const onError = () => {
        currentlyLoading--;
        img.style.opacity = IMAGE_OPACITY_ERROR;
        img.removeEventListener('load', onLoad);
        img.removeEventListener('error', onError);
        delete img.dataset.loading;

        requestAnimationFrame(() => processImageQueue());
    };

    img.addEventListener('load', onLoad, { once: true });
    img.addEventListener('error', onError, { once: true });
    img.src = realSrc;
}

export function setImageObserverEnabled(enabled) {
    imageObserverEnabled = enabled;
    if (enabled) {
        processImageQueue();
    }
}