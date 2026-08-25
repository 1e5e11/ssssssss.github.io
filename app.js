var content = [
    { type: "", t: "啊这软件园", s: "点击docs查看更多信息", d: "", o: "https://ssssssss.eu.org/", g: "https://ssssssss.eu.org/docs", ai: 1, firstDev: "2026-08-23", lastUpdate: "" },
    { type: "函数画板", t: "啊这函数画板", s: "推荐使用啊这函数画板", d: "", o: "http://h.ssssssss.eu.org/", g: "http://h.ssssssss.eu.org/v/19/course.txt", ai: 0, firstDev: "2022-04-23", lastUpdate: "2025-03-07" },
    { type: "数学工具", t: "啊这数字性质查看器", s: "AZNumberChecker", d: "", o: "https://ssssssss.eu.org/n/", g: "#", ai: 0, firstDev: "2025-07-21", lastUpdate: "" },
    { type: "数学游戏", t: "啊这猜数字游戏", s: "AZNumberGuess", d: "", o: "https://ssssssss.eu.org/ng/", g: "#", ai: 0, firstDev: "2025-11-08", lastUpdate: "" },
    { type: "游戏", t: "啊这扫雷", s: "生成无猜布局", d: "", o: "https://minesweeper.ssssssss.eu.org/", g: "#", ai: 1, firstDev: "2026-06-14", lastUpdate: "2026-08-04" },
    { type: "工具", t: "啊这翻译器", s: "啊这生草器", d: "", o: "https://bjsdfz.ssssssss.eu.org/mdy/", g: "#", ai: 0, firstDev: "2023", lastUpdate: "" },
    { type: "工具", t: "红楼梦人物关系查询", s: "双向BFS", d: "", o: "https://bjsdfz.ssssssss.eu.org/hongloumeng/", g: "#", ai: 0, firstDev: "2024-09-01", lastUpdate: "" },
    { type: "工具", t: "啊这起始页", s: "", d: "", o: "https://qsy.ssssssss.eu.org/", g: "#", ai: 0, firstDev: "2022-02", lastUpdate: "" },
    { type: "", t: "AZOS", s: "", d: "", o: "https://bjsdfz.ssssssss.eu.org/azos", g: "#", ai: 0, firstDev: "2021-10", lastUpdate: "" },
    { type: "工具", t: "像素移动", s: "由一张图片的像素生成另一张", d: "", o: "https://ssssssss.eu.org/pixelmove/", g: "#", ai: 0, firstDev: "2026-05-16", lastUpdate: "2026-08-04" },
];

function openjc(x) {
    window.open(x)
}


function render() {
    var wrap = document.getElementById('cardarea');
    wrap.innerHTML = '';
    content.forEach(function (it, i) {
        var card = document.createElement('div');
        card.className = 'card';

        var t = document.createElement('div');
        t.className = 't';
        t.innerHTML = it.t;
        card.appendChild(t);

        var s = document.createElement('div');
        s.className = 's';
        s.innerHTML = it.s;
        card.appendChild(s);

        var d = document.createElement('div');
        d.className = 'd';
        d.innerHTML = it.d;
        card.appendChild(d);

        var ai = document.createElement('div');
        ai.className = 'ai' + (it.ai ? ' on' : '');
        ai.innerHTML = 'AI参与';
        card.appendChild(ai);

        var time = document.createElement('div');
        time.className = 'time';
        var timeParts = [];
        if (it.firstDev) timeParts.push('首次开发: ' + it.firstDev);
        if (it.lastUpdate) timeParts.push('最后更新: ' + it.lastUpdate);
        time.innerHTML = timeParts.join(' | ');
        card.appendChild(time);

        var o = document.createElement('button');
        o.className = 'btn o';
        o.innerHTML = 'open';
        o.onclick = function () { openjc(it.o) };
        card.appendChild(o);

        var g = document.createElement('button');
        g.className = 'btn g';
        g.innerHTML = 'docs';
        g.onclick = function () { openjc(it.g) };
        card.appendChild(g);

        wrap.appendChild(card);
    });
}

window.onresize = function () { render() };
window.onload = function () {
    var ldd = document.getElementById('ldd');
    ldd.style.opacity = '1';
    setTimeout(function () {
        ldd.style.opacity = '0';
        render();
    }, 500);
};
