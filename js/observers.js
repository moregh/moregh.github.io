/*
    War Target Finder - Intersection Observer Management
    
    Copyright (C) 2025 moregh (https://github.com/moregh/)
    Licensed under AGPL License.
*/

import { PERFORMANCE_CONFIG, MAX_CONCURRENT_IMAGES } from './config.js';

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

                            // Throttle processing to avoid overwhelming the browser
                            this.scheduleImageProcessing();
                        }
                    }
                });
            }, {
                rootMargin: '20px', // Reduced from 50px for more aggressive throttling
                threshold: 0.2 // Increased threshold for better performance
            });
        }
        return this.imageObserver;
    }

    scheduleImageProcessing() {
        if (this.imageProcessingTimeout) return;

        this.imageProcessingTimeout = requestAnimationFrame(() => {
            processImageQueue();
            this.imageProcessingTimeout = null;
        });
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

    // Batch observe operations for better performance
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

        this.batchTimeout = requestAnimationFrame(() => {
            this.processBatches();
            this.batchTimeout = null;
        });
    }

    processBatches() {
        // Process image observations in batches
        const imageBatches = this.chunkArray(this.pendingImageObservations, PERFORMANCE_CONFIG.BATCH_SIZE);
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

        // Process animation observations in batches
        const animationBatches = this.chunkArray(this.pendingAnimationObservations, PERFORMANCE_CONFIG.BATCH_SIZE);
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

        // Clear pending arrays
        this.pendingImageObservations = [];
        this.pendingAnimationObservations = [];
    }

    chunkArray(array, chunkSize) {
        const chunks = [];
        for (let i = 0; i < array.length; i += chunkSize) {
            chunks.push(array.slice(i, i + chunkSize));
        }
        return chunks;
    }

    cleanup() {
        if (this.batchTimeout) {
            cancelAnimationFrame(this.batchTimeout);
            this.batchTimeout = null;
        }

        if (this.imageProcessingTimeout) {
            cancelAnimationFrame(this.imageProcessingTimeout);
            this.imageProcessingTimeout = null;
        }

        // Clear pending operations
        this.pendingImageObservations = [];
        this.pendingAnimationObservations = [];

        // Existing cleanup code...
        this.observedImages.forEach(img => {
            try { this.imageObserver?.unobserve(img); } catch (e) { }
        });
        this.observedAnimations.forEach(element => {
            try { this.animationObserver?.unobserve(element); } catch (e) { }
        });

        this.imageObserver?.disconnect();
        this.animationObserver?.disconnect();

        this.imageObserver = null;
        this.animationObserver = null;
        this.observedImages.clear();
        this.observedAnimations.clear();

        // Clear image queues
        imageLoadQueue = [];
        priorityImageQueue = [];
    }

    cleanupDeadElements() {
        for (const img of this.observedImages) {
            if (!document.contains(img)) {
                this.imageObserver?.unobserve(img);
                this.observedImages.delete(img);
            }
        }
        for (const element of this.observedAnimations) {
            if (!document.contains(element)) {
                this.animationObserver?.unobserve(element);
                this.observedAnimations.delete(element);
            }
        }
    }
}

// Image loading queue management with priority
let imageLoadQueue = [];
let priorityImageQueue = []; // For above-the-fold images
let currentlyLoading = 0;
let imageObserverEnabled = true;
let lastScrollTime = 0;

export function processImageQueue() {
    const now = Date.now();
    const isScrolling = (now - lastScrollTime) < 150; // Check if user was scrolling recently

    // Process priority queue first (above-the-fold images)
    while (priorityImageQueue.length > 0 && currentlyLoading < MAX_CONCURRENT_IMAGES && imageObserverEnabled) {
        const img = priorityImageQueue.shift();
        if (img && img.dataset.src && document.contains(img) && !img.src.startsWith('https://')) {
            loadSingleImage(img);
        }
    }

    // Reduce concurrent loading during scrolling for better performance
    const maxConcurrent = isScrolling ? Math.max(1, MAX_CONCURRENT_IMAGES / 2) : MAX_CONCURRENT_IMAGES;

    // Process regular queue
    while (imageLoadQueue.length > 0 && currentlyLoading < maxConcurrent && imageObserverEnabled) {
        const img = imageLoadQueue.shift();
        if (img && img.dataset.src && document.contains(img) && !img.src.startsWith('https://')) {
            loadSingleImage(img);
        }
    }
}

// Track scroll state for image loading optimization
function trackScrollState() {
    lastScrollTime = Date.now();
}

// Set up scroll tracking for image loading optimization
if (typeof window !== 'undefined') {
    window.addEventListener('scroll', trackScrollState, { passive: true });
}

function loadSingleImage(img) {
    const realSrc = img.dataset.src;
    if (!realSrc || img.src === realSrc) return;

    currentlyLoading++;
    img.style.opacity = '0.3'; // Show loading state

    const onLoad = () => {
        currentlyLoading--;
        img.style.opacity = '1'; // Show loaded state
        img.removeEventListener('load', onLoad);
        img.removeEventListener('error', onError);
        delete img.dataset.loading;

        // Process next in queue
        requestAnimationFrame(() => processImageQueue());
    };

    const onError = () => {
        currentlyLoading--;
        img.style.opacity = '0.5'; // Show error state
        img.removeEventListener('load', onLoad);
        img.removeEventListener('error', onError);
        delete img.dataset.loading;

        // Process next in queue
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