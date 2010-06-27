
// A list of callbacks is maintained here, keyed on URL.
// This allows us to coalesce multiple concurrent requests for the
// same data into a single HTTP request.
// This gets cleared out if we navigate to a new page to avoid
// race conditions.
var callbacks = {};
var onPageChange = null;

function handlePage(targetElem, hash) {

    if (onPageChange) {
        onPageChange();
        onPageChange = null;
    }

    // Starting a new pageview.
    callbacks = {};

    var path = hash.substr(1);

    if (path == "") {
        // Default view is the agency listing page.
        return internalRedirect(["a"]);
    }

    setTitle("");
    targetElem.html("");
    $("#offline").css("display", "none");

    var pathChunks = path.split("/");

    if (pathChunks[0] == "a") {
        if (pathChunks.length == 1) {
            // TODO: Agency listing
        }
        else {
            var agencyId = pathChunks[1];
            if (pathChunks.length == 2) {
                return renderAgencyPage(targetElem, agencyId);
            }
            else {
                if (pathChunks[2] == "r") {
                    var routeId = pathChunks[3];

                    if (! routeId) return;

                    if (pathChunks.length == 4) {
                        return renderRouteRunPage(targetElem, agencyId, routeId, null);
                    }

                    if (pathChunks[4] == "r") {
                        var runId = pathChunks[5];
                        return renderRouteRunPage(targetElem, agencyId, routeId, runId);
                    }
                    else if (pathChunks[4] == "s") {
                        var stopId = pathChunks[5];
                        return renderStopPage(targetElem, agencyId, stopId);
                    }
                }
            }
        }
    }

    // If we get this far then the path wasn't recognized.
    targetElem.html("<p>Invalid fragment identifier</p>");

    return null;
}

function renderAgencyPage(targetElem, agencyId) {
    var agencyHeader = $("<h2>&nbsp;</h2>");
    setPageType("agency");
    targetElem.append(agencyHeader);
    getCacheData(["agencies", agencyId], function (data) {
        agencyHeader.text(data.display_name);
        setTitle(data.display_name);
    });

    var routeList = $("<ul class='chooselist'></ul>");
    targetElem.append(routeList);
    getCacheData(["agencies", agencyId, "routes"], function (data) {
        // As a special case, if there's only one route for
        // a particular agency then we just jump straight to
        // that route's page.
        if (data.items.length == 1) {
            internalRedirect(["a", agencyId, "r", data.items[0].id]);
            return;
        }

        for (var i = 0; i < data.items.length; i++) {
            var route = data.items[i];
            var li = $("<li></li>");
            var a = $("<a></a>");
            a.text(route.display_name);
            a.attr("href", makeUrl(["a", agencyId, "r", route.id]));
            li.append(a);
            routeList.append(li);
        }
    });
}

function renderRouteRunPage(targetElem, agencyId, routeId, runId) {
    var header = $("<h2>&nbsp;</h2>");
    setPageType("routerun");
    targetElem.append(header);
    getCacheMultiData([ ["agencies", agencyId, "routes", routeId], ["agencies", agencyId ] ], function (data) {
        header.text(data[0].display_name);
        setTitle(data[0].display_name+" ("+data[1].display_name+")");
    });

    var runList = $("<ul id='runlist'></ul>");
    var stopList = $("<ul id='stoplist' class='chooselist'></ul>");
    targetElem.append(runList);
    targetElem.append(stopList);

    getCacheData(["agencies", agencyId, "routes", routeId, "runs"], function (data) {
        for (var i = 0; i < data.items.length; i++) {
            var run = data.items[i];
            if (! run.display_in_ui) continue;

            // Default to showing the first one if one isn't explicitly selected.
            if (! runId) runId = run.id;

            var li = $("<li></li>");
            var a = runId == run.id ? $("<span></span>") : $("<a></a>");
            a.text(run.direction_name ? run.direction_name : run.display_name);
            a.attr("href", makeUrl(["a", agencyId, "r", routeId, "r", run.id]));
            li.append(a);
            runList.append(li);
        }

        if (runId) {
            getCacheData(["agencies", agencyId, "routes", routeId, "runs", runId, "stops"], function (data) {
                for (var i = 0; i < data.items.length; i++) {
                    var stop = data.items[i];

                    var li = $("<li></li>");
                    var a = $("<a></a>");
                    a.text(stop.display_name);
                    a.attr("href", makeUrl(["a", agencyId, "r", routeId, "s", stop.id]));
                    li.append(a);
                    stopList.append(li);
                }
            });
        }

    });

}

function renderStopPage(targetElem, agencyId, stopId) {
    var header = $("<h2>&nbsp;</h2>");
    setPageType("stop");
    targetElem.append(header);
    getCacheMultiData([ ["agencies", agencyId, "stops", stopId], ["agencies", agencyId ] ], function (data) {
        header.text(data[0].display_name);
        setTitle(data[0].display_name+" ("+data[1].display_name+")");
    });

    var predictionList = $("<ul id='predictionslist'></ul>");
    var timestampElem = $("<p id='lastupdate'></p>");
    targetElem.append(predictionList);
    targetElem.append(timestampElem);

    var updatePredictions = function () {
        if (navigator.onLine) {
            getData(["agencies", agencyId, "stops", stopId, "predictions"], function (data) {
                predictionList.html('');

                if (data.items.length == 0) {
                    predictionList.html('<li class="bad">There are currently no predictions.</li>');
                    return;
                }

                for (var i = 0; i < data.items.length; i++) {
                    var li = $("<li></li>");
                    (function () {
                        var prediction = data.items[i];
                        var routeId = prediction.route_id;
                        var runId = prediction.run_id;
                        var isDeparting = prediction.is_departing;
                        var minutes = prediction.minutes;

                        var routeElem = $("<div class='routename'></div>");
                        routeElem.text(routeId);
                        var runElem = $("<div class='runname'>&nbsp;</div>");
                        var timeElem = $("<div class='time'></div>");
                        timeElem.text(minutes != 0 ? minutes+" min" : (isDeparting ? "Departing" : "Arriving"));

                        // Asynchronously fill in the route and run names.
                        getCacheData([ "agencies", agencyId, "routes", routeId ], function (data) {
                            routeElem.text(data.display_name);
                        });
                        getCacheData([ "agencies", agencyId, "routes", routeId, "runs", runId ], function (data) {
                            runElem.text(data.display_name);
                        });

                        li.append(routeElem);
                        li.append(timeElem);
                        li.append(runElem);
                    })();

                    predictionList.append(li);
                }
            });
        }
        else {
            predictionList.html('<li class="bad">Unable to retrieve predictions: no network connection.</li>');
        }
        timestampElem.text("Last Updated "+new Date());
    };
    updatePredictions();
    var interval = setInterval(updatePredictions, 20000);
    onPageChange = function () {
        clearInterval(interval);
    };
}

function setTitle(title) {
    if (title) {
        document.title = title + " - ProximoWeb";
    }
    else {
        document.title = "ProximoWeb";
    }
}

function setPageType(type) {
    $("#main").attr('class', type);
}

function getCacheData(pathChunks, callback) {
    var cacheTtl = 86400000; // One day
    var currentTime = new Date().getTime();

    var cacheKey = "proxcache:" + pathChunks.map(function (a) { return encodeURIComponent(a); }).join("/");
    var cacheValue = null;

    if (window.localStorage) {
        cacheValue = localStorage.getItem(cacheKey);
        if (cacheValue) {
            cacheValue = JSON.parse(cacheValue);

            var cacheTime = cacheValue.time;
            if (navigator.onLine && (currentTime - cacheTime) > cacheTtl) {
                cacheValue = null;
            }
        }
    }

    if (cacheValue) {
        callback(cacheValue.data);
    }
    else {
        if (navigator.onLine) {
            var realCallback = function (data) {
                if (data && window.localStorage) {
                    localStorage.setItem(cacheKey, JSON.stringify({"data": data, "time": currentTime}));
                }
                callback(data);
            };
            getData(pathChunks, realCallback);
        }
        else {
            // FIXME: Implement some kind of full-page error when we reach this state,
            // letting the user know that he must come online to read this page.
            $("#offline").css("display", "");
        }
    }
}

function getCacheMultiData(pathChunksList, callback) {
    var wantedParts = pathChunksList.length;
    var gotSoFar = 0;
    var ret = [];
    for (var i = 0; i < pathChunksList.length; i++) {
        (function () {
             var idx = i;
             getCacheData(pathChunksList[i], function (data) {
                 gotSoFar++;
                 ret[idx] = data;
                 if (gotSoFar >= wantedParts) {
                     callback(ret);
                 }
             });
        })();
    }
}

function getData(pathChunks, callback) {

    var url = "http://proximobus.appspot.com/" + pathChunks.map(function (a) { return encodeURIComponent(a); }).join("/") + ".json";

    if (callbacks[url]) {
        // A request for this URL is already in progress, so just add a new callback.
        callbacks[url].push(callback);
    }
    else {
        var realCallback = function (data) {
            if (callbacks[url]) {
                var myCallbacks = callbacks[url];
                for (var i = 0; i < myCallbacks.length; i++) {
                    myCallbacks[i](data);
                }
                // Now nuke our callback array so that subsequent requests
                // won't try to coalesce to this completed request.
                delete callbacks[url];
            }
        };
        callbacks[url] = [ callback ];
        $.getJSON(url, realCallback);
    }
}

function makeUrl(pathChunks) {
    return "#" + pathChunks.join("/");
}

function internalRedirect(pathChunks) {
    var hash = makeUrl(pathChunks);
    handlePage($("#main"), hash);
}

$(document).ready(function() {
    handlePage($("#main"), window.location.hash);
    $(window).bind("hashchange", function () { scroll(0,0); handlePage($("#main"), window.location.hash); });
    $(window).bind("online", function () { handlePage($("#main"), window.location.hash); });
    $(window).bind("offline", function () { handlePage($("#main"), window.location.hash); });
    $("#throbber").css("display", "none");

    $("#throbber").ajaxStart(function() {
        $("#throbber").css("display", "");
    });
    $("#throbber").ajaxStop(function() {
        $("#throbber").css("display", "none");
    });


});


