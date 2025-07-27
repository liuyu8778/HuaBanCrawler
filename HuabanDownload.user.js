// ==UserScript==
// @name         花瓣网画板批量下载（瀑布流版）
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  自动滚动加载并下载花瓣网高清媒体文件
// @match        *://huaban.com/boards/*
// @grant         GM.xmlHttpRequest
// @grant        GM_download
// ==/UserScript==

(function() {
    'use strict';

    console.log("项目启动");

    const processedMedia = new Set();
    const failedMedia = new Set();

    const config = {
        scrollInterval: 5000,
        scrollStep: 500,
        maxConcurrent: 3,
        checkInterval: 1000,
        scrollDebounce: 2000,
        timeDelay: 100,
        originalTimeDelay: 100,
        timeDelayStep:10000,
    };

    const downloadQueue = {
        active: 0,
        items: new Set(),
        isProcessing: false, // 新增处理状态标志

        async addItem(baseUrl) {
            if (!processedMedia.has(baseUrl)) {
                this.items.add(baseUrl);
                processedMedia.add(baseUrl);
                console.log(`[队列] 新增任务：${baseUrl}，队列长度${this.items.size}`);
                this.startProcessing(); // 仅触发处理检查
            }
        },

        async startProcessing() {
            //if (this.isProcessing) return;
            //this.isProcessing = true;
            if(this.active>=config.maxConcurrent){
                return;
            }

            while (this.items.size > 0) {
                // 等待并发槽位
                while (this.active >= config.maxConcurrent) {
                    await new Promise(r => setTimeout(r, config.checkInterval));
                }
                await new Promise(r => setTimeout(r, config.timeDelay));

                this.active++;
                // 取出任务
                const baseUrl = this.items.values().next().value;
                this.items.delete(baseUrl);

                try {
                    await this.downloadMedia(baseUrl);
                } catch (e) {
                    console.error(`[下载失败] ${baseUrl}:`, e);
                } finally {
                    this.active--;
                    await new Promise(r => setTimeout(r, config.timeDelay));
                    config.timeDelay = config.originalTimeDelay;
                }
            }

            this.isProcessing = false;
        },

        async downloadMedia(baseUrl) {
            const hdUrl = baseUrl.split('_fw')[0]; // 去除尺寸参数获取原图

            try {
                // 直接使用 GM_download 下载
                await new Promise((resolve, reject) => {
                    GM_download({
                        url: hdUrl,
                        name: hdUrl.match(/\/([^\/?]+)(?=\/?$)/)[1]+'.jpg', // 生成唯一文件名
                        timeout: 20000,
                        headers: {
                            "Referer": "https://huaban.com/", // 声明来源页
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                        },
                        onload: () => resolve(),
                        onerror: (err) => {
                            reject(err);
                            downloadQueue.items.add(baseUrl);
                                          },
                        ontimeout: () => {
                            reject("Timeout");
                            downloadQueue.items.add(baseUrl);}
                    });
                });

                console.log(`[成功] ${hdUrl}`);
                failedMedia.delete(hdUrl);
            } catch (err) {
                console.error('下载失败:', hdUrl, '错误：', err);
                config.timeDelay += config.timeDelayStep;
                this.items.add(baseUrl); // 重试机制
            }
        }

    };

    const scrollController = {
        lastHeight: 0,
        isScrolling: false,

        start() {
            this.isScrolling = true;
            this.scrollStep();
            this.watchLoad();
        },

        scrollStep() {

            window.scrollBy(0, config.scrollStep);

            setTimeout(() => {
                const newHeight = document.documentElement.scrollHeight;

                if (newHeight > this.lastHeight) {
                    this.lastHeight = newHeight;
                }

                this.scrollStep();

            }, config.scrollInterval);
        },

        watchLoad() {
            const observer = new MutationObserver(mutations => {
                const newItems = [...document.querySelectorAll('img.hb-image')]
                    .filter(img => {
                        const src = img.src;
                        return src.includes('gd-hbimg.huaban.com') &&
                              !processedMedia.has(src.split('_fw')[0]);
                    })
                    .map(img => {
                        const src = img.src;
                        return src.split('_fw')[0]; // 去除尺寸参数
                    });

                newItems.forEach(baseUrl => {
                    downloadQueue.addItem(baseUrl);
                });
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['src']
            });
        }
    };
    setTimeout(() => {
        if (location.pathname.includes('/boards/')) {
            scrollController.start();
        }}, 3000);
    // 初始化

})();