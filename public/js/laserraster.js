'use strict';

/*

    AUTHOR:  Peter van der Walt
    Addional work by Nathaniel Stenzel and Sven Hecht

    LaserWeb Raster to GCODE Paperscript
    Copyright (C) 2015 Peter van der Walt

    THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
    WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
    MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
    ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
    WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
    ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
    OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.

*/

var startgcode;
var laseron;
var laseroff;
var lasermultiply;
var homingseq;
var endgcode;


// add MAP function to the Numbers function
Number.prototype.map = function(in_min, in_max, out_min, out_max) {
    return (this - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
};

if (!String.prototype.format) {
    String.prototype.format = function() {
        var args = arguments;
        return this.replace(/{(\d+)}/g, function(match, number) {
            return typeof args[number] != 'undefined' ? args[number] : match;
        });
    };
}

function Rasterizer(config) {

    this.config = config;

    console.log('[Rasterizer] Width: ' + this.config.imgwidth + '  Height: ' + this.config.imgheight);

    // Init some variables we'll be using in the process
    this.path = '';
    this.intensity = '';
    //this.gcodex = '';

    this.moveCount = 0; // Keep count of Gcode lines so we can optimise, lower = better
    this.skip = 0;
    this.dir = 1;
    //this.lastPosx = -1;
    this.megaPixel = 0;
    this.x = 0;
    //this.endPosx = 0;
    this.grayLevel = 0;
    //this.gridSize = 1;
    this.startTime = 0;

    this.rasterIntervalTimer = null;

    // GCODE Header
    // var useVariableSpeed = this.config.useVariableSpeed;

    startgcode = $('#startgcode').val();
    laseron = $('#laseron').val();
    laseroff = $('#laseroff').val();
    if ($('#lasermultiply').val()) {
      lasermultiply = $('#lasermultiply').val();
    } else {
      lasermultiply = 100;
      printLog('NB - generated with default value of S100 since you have not yet configured LaserWeb for your machine.  Click that settings button and configure the Max PWM S Value (and all the other settings please).... ', errorcolor)
    }
    homingseq = $('#homingseq').val();
    endgcode = $('#endgcode').val();

    this.result = [
        '; Raster:',
        // '; Firmware: {0}',
        '; Laser Min: {0}%',
        '; Laser Max: {1}%',
        '; Black Speed: {2}mm/s',
        '; White Speed: {3}mm/s',
        '; Resolution (mm per pixel): {4}mm',
        '; Laser Spot Size: {5}mm',
        '; Laser Feedrate: {6}mm/s',
        '; X Offset: {8}mm',
        '; Y Offset: {9}mm \n',
        'G1 F{7}\n'
        //'G0 F{7}'
    ].join('\n').format(
        // this.config.firmware,
        this.config.minIntensity,
        this.config.maxIntensity,
        this.config.blackRate,
        this.config.whiteRate,
        this.config.spotSize1,
        this.config.beamSize1,
        this.config.feedRate,
        this.config.rapidRate,
        this.config.xOffset,
        this.config.yOffset);



    // this.result += '; Start GCode\n'
    // this.result += startgcode
    // this.result += '\n';

    // if (this.config.firmware.indexOf('Lasaur') == 0) {
    //   this.result += 'M80\n'; // Air Assist on
    // }

    // console.log('Variable Speed?:  ' + useVariableSpeed);
}

Rasterizer.prototype.figureIntensity = function() {
    var intensity = (1 - this.grayLevel) * 100; //  Also add out Firmware specific mapping using intensity (which is 0-100) and map it between minIntensity and maxIntensity variables above * firmware specific multiplier (grbl 0-255, smoothie 0-1, etc)
    //Constraining Laser power between minIntensity and maxIntensity
    //console.log('Constraining');

    if (parseFloat(intensity) > 0) {
        intensity = intensity.map(0, 100, parseInt(this.config.minIntensity, 10), parseInt(this.config.maxIntensity, 10));
    } else {
        intensity = 0;
    }

    // Firmware Specific Gcode Output
    // if (this.config.firmware.indexOf('Grbl') == 0) {
    //   intensity = intensity.map(0, 100, 0, 255);
    //   intensity = intensity.toFixed(0);
    // } else if (this.config.firmware.indexOf('Smooth') == 0) {
    //   intensity = intensity / 100;
    //   //intensity = intensity.toFixed(1);
    // } else if (this.config.firmware.indexOf('Lasaur') == 0) {
    //   intensity = intensity.map(0, 100, 0, 255);
    //   intensity = intensity.toFixed(0);
    // } else {
    // intensity = intensity.map(0, 100, 0, parseInt(lasermultiply));
    // intensity = intensity.toFixed(0);

    if (parseInt(lasermultiply) <= 1) {
        var intensity = parseFloat(intensity) / 100;
        intensity = parseFloat(intensity).toFixed(2);
    } else {
        var intensity = parseFloat(intensity) * (parseInt(lasermultiply) / 100);
        intensity = intensity.toFixed(0);
    }
    // }

    return intensity;
};

Rasterizer.prototype.figureSpeed = function(passedGrey) {
    var calcspeed = passedGrey * 100;
    //console.log('Figure speed for brightness');

    calcspeed = calcspeed.map(0, 100, parseInt(this.config.blackRate, 10), parseInt(this.config.whiteRate, 10));
    calcspeed = calcspeed.toFixed(0);

    return calcspeed;
};

Rasterizer.prototype.init = function(div) {
    console.log('INIT Container: ', this.config.div)
    this.startTime = Date.now();

    // Initialise
    project.clear();

    // Create a raster item using the image tag 'origImage'
    var container = this.config.div;
    this.raster = new Raster(container);
    this.raster.visible = false;

    // Log it as a sanity check
    console.log('Constraining Laser power between {0}% and {1}%'.format(this.config.minIntensity, this.config.maxIntensity));
    console.log('Height: {0}px, Width: {1}px'.format(this.config.imgheight, this.config.imgwidth));
    console.log('Spot Size: {0}mm'.format(this.config.spotSize1));
    console.log('Raster Width: {0} Height: {1}'.format(this.raster.width, this.raster.height));
    console.log('G0: {0}mm/s, G1: {1}mm/s'.format(this.config.rapidRate, this.config.feedRate));
    console.log('Black speed: {0} Whitespeed: {1}'.format(this.config.blackRate, this.config.whiteRate));

    // As the web is asynchronous, we need to wait for the raster to load before we can perform any operation on its pixels.
    this.raster.on('load', this.onRasterLoaded.bind(this));
    console.log('Raster: ', this.raster)
};


Rasterizer.prototype.rasterRow = function(y) {
    // console.log('[Rasterizer] rasterRow', y);

    // Calculate where to move to to start the first and next rows - G0 Yxx move between lines

    var posy = y;
    // posy = (posy * this.config.spotSize1) - parseFloat(this.config.yOffset);
    if (this.config.imagePos == "TopLeft") {
    //   posy = (posy * this.config.spotSize1) - parseFloat(this.config.yOffset) + ((laserymax / 2) + this.config.imgheight);
      posy = (posy * this.config.spotSize1) + parseFloat(this.config.yOffset) - parseFloat(laserymax) + parseFloat(this.config.physicalHeight);
    } else {
      posy = (posy * this.config.spotSize1) - parseFloat(this.config.yOffset);
    }
    posy = posy.toFixed(3);

    // Offset Y since Gcode runs from bottom left and paper.js runs from top left
    var gcodey = (this.config.imgheight * this.config.spotSize1) - posy;
    gcodey = gcodey.toFixed(3);
    this.result += 'G0 Y{0}\n'.format(gcodey);

    // Clear grayscale values on each line change
    var lastGrey = -1;
    var lastIntensity = -1;

    // Get a row of pixels to work with
    var ImgData = this.raster.getImageData(0, y, this.raster.width, 1);
    var pixels = ImgData.data;

    // Run the row:
    for (var px = 0; px <= this.raster.width; px++) {
        var x;
        var posx;
        if (this.dir > 0) { // Forward
            x = px;
            posx = x;
        } else { // Backward
            x = this.raster.width - px - 1;
            posx = x + 1;
        }

        // Convert Pixel Position to millimeter position
        posx = (posx * this.config.spotSize1 + parseFloat(this.config.xOffset));
        posx = posx.toFixed(3);
        // Keep some stats of how many pixels we've processed
        this.megaPixel++;

        // The Luma grayscale of the pixel
	var alpha = pixels[x*4+3]/255.0;                                                   // 0-1.0
        var lumaGray = (pixels[x*4]*0.3 + pixels[x*4+1]*0.59 + pixels[x*4+2]*0.11)/255.0;  // 0-1.0
	lumaGray = alpha * lumaGray + (1-alpha)*1.0;
	this.grayLevel = lumaGray.toFixed(3);
	this.graLevel = lumaGray.toFixed(1);

	var speed = this.config.feedRate;
        if (lastGrey != this.grayLevel) {
            intensity = this.figureIntensity();
            speed = this.figureSpeed(lastGrey);
            lastGrey = this.grayLevel;
        }

        // Can't miss the first pixel (;
        //if (px == 0) { this.lastPosx = posx; }

        //if we are on the last dot, force a chance for the last pixel while avoiding forcing a move with the laser off
        if (px == this.raster.width) {
            intensity = -1;
        }

        // If we dont match the grayscale, we need to write some gcode...
        if (intensity != lastIntensity) {
            this.moveCount++;

            //console.log('From: ' + this.lastPosx + ', ' + lastPosy + '  - To: ' + posx + ', ' + posy + ' at ' + lastIntensity + '%');
            if (lastIntensity > 0) {
                // if (this.config.useVariableSpeed == "true") {
                    // if (this.config.firmware.indexOf('Grbl') == 0) {
                    //   this.result += 'M3 S{2}\nG1 X{0} Y{1} F{3} S{2}\nM5\n'.format(posx, gcodey, lastIntensity, speed);
                    // } else {
                    if (laseron) {
                        this.result += laseron
                        this.result += '\n'
                    }
                    this.result += 'G1 X{0} S{2} F{3}\n'.format(posx, gcodey, lastIntensity, speed);
                    if (laseroff) {
                        this.result += laseroff
                        this.result += '\n'
                    }
                    // }
                // } else {
                //     // if (this.config.firmware.indexOf('Grbl') == 0) {
                //     //   this.result += 'M3 S{2}\nG1 X{0} Y{1} S{2}\nM5\n'.format(posx, gcodey, lastIntensity);
                //     // } else {
                //     if (laseron) {
                //         this.result += laseron
                //         this.result += '\n'
                //     }
                //     this.result += 'G1 X{0} S{2}\n'.format(posx, gcodey, lastIntensity);
                //     if (laseroff) {
                //         this.result += laseroff
                //         this.result += '\n'
                //     }
                //     // }
                // }
                // This will hopefully get rid of black marks at the end of a line segment
                // It seems that some controllers dwell at a spot between gcode moves
                // If this does not work, switch to G1 to this.endPosx and then G0 to posx
                //this.result += 'G1 S0\n';
            } else {
                if ((intensity > 0) || (this.config.optimizelineends == false)) {
                    this.result += 'G0 X{0} S0\n'.format(posx, gcodey);
                }

            }

            // Debug:  Can be commented, but DON'T DELETE - I use it all the time when i find bug that I am not sure of
            // whether the root cause is the raster module or the gcode viewer module - by drawing the paper.js object I can
            // do a comparison to see which it is
            // Draw canvas (not used for GCODE generation)
            //path = new Path.Line({
            //    from: [(this.lastPosx * this.gridSize), (posy * this.gridSize)],
            //    to: [(this.endPosx * this.gridSize), (posy * this.gridSize)],
            //    strokeColor: 'black'
            //    });
            //path.strokeColor = 'black';
            //path.opacity = (lastIntensity / 100);
            // End of debug drawing
        } else {
            this.skip++
        }

        // End of write a line of gcode
        //this.endPosx = posx;

        // Store values to use in next loop
        if (intensity != lastIntensity) {
            lastIntensity = intensity;
            //this.lastPosx = posx
        }
    }

    this.dir = -this.dir; // Reverse direction for next row - makes us move in a more efficient zig zag down the image
};


Rasterizer.prototype.rasterInterval = function() {
    if (this.currentPosy < this.raster.height) {

        this.rasterRow(this.currentPosy);

        this.currentPosy++;
        var progress = Math.round((this.currentPosy / this.raster.height) * 100.0);
        //$('#rasterProgressShroud .progress-bar').width(progress + "%");
        $('#rasterProgressPerc').html(progress + "%");
        NProgress.set(progress / 100);
        //console.log('[Rasterizer] ', progress, '% done');
    } else {
        this.onFinish();
        //var rasterSendToLaserButton = document.getElementById("rasterWidgetSendRasterToLaser");
        //if (rasterSendToLaserButton.style.display == "none") { // Raster Mode
        NProgress.done();
        NProgress.remove();
        //$('#rasterparams').hide();
        //$('#rasterwidget').modal('hide');
        // } else {  // Calibration Mode
        $('#rasterparams').show();
        $('#rasterProgressShroud').hide();
        //   $('.progress').removeClass('active');
        // 	$('#rasterProgressShroud .progress-bar').width(0);
        // }
        window.clearInterval(this.rasterIntervalTimer);
    }
};

Rasterizer.prototype.onRasterLoaded = function() {
    console.log('[Rasterizer] onRasterLoaded');
    var rasterSendToLaserButton = document.getElementById("rasterWidgetSendRasterToLaser");
    //if (rasterSendToLaserButton.style.display == "none") {  // Raster Mode
    $('#rasterparams').hide();
    $('#rasterProgressShroud').show();
    $('.progress').removeClass('active');
    $('#rasterProgressShroud .progress-bar').width(0);
    // } else {  // Calibration Mode
    //   $('#rasterparams').hide();
    //   $('#rasterProgressShroud').show();
    //   $('.progress').removeClass('active');
    // 	$('#rasterProgressShroud .progress-bar').width(0);
    // }

    // Iterate through the Pixels asynchronously
    this.currentPosy = 0;
    this.rasterIntervalTimer = window.setInterval(this.rasterInterval.bind(this), 10);
};

Rasterizer.prototype.onFinish = function() {
    // if (firmware.indexOf('Lasaur') == 0) {
    //   this.result += 'M81\n'; // Air Assist off
    // }

    // Populate the GCode textarea
    var existinggcode =  document.getElementById('gcodepreview').value
    document.getElementById('gcodepreview').value = existinggcode + this.result;
    console.log('Optimized by number of line: ', this.skip);
    // Some Post-job Stats and Cleanup
    console.log('Number of GCode Moves: ', this.moveCount);
    var pixeltotal = this.raster.width * this.raster.height;
    console.log('Pixels: {0} done, of {1}'.format(this.megaPixel, pixeltotal));

    console.timeEnd("Process Raster");
    var currentTime = Date.now();
    var elapsed = (currentTime - this.startTime);
    $('#console')
        .append('<p class="pf" style="color: #009900;"><b>Raster completed in {0}ms</b></p>'.format(elapsed))
        .scrollTop($("#console")[0].scrollHeight - $("#console").height());

    if (this.config.completed) {
        this.config.completed();
    }
};


this.RasterNow = function(config) {
    console.time("Process Raster");
    printLog('Process Raster', msgcolor)
    var div = config.div;
    var rasterizer = new Rasterizer(config);
    console.log('from Container: ', div)
    rasterizer.init(div);
};

this.G7RasterNow = function(config) {
    console.time("Process G7 Raster");
    printLog('Process G7 Raster', msgcolor)

    var rasterizer = new G7Rasterizer(config);
    rasterizer.init();
};

var G7startgcode;
var G7laseron;
var G7laseroff;
var G7lasermultiply;
var G7homingseq;
var G7endgcode;

function G7Rasterizer(config) {

    this.config = config;

    console.log('[G7Rasterizer] Width: ' + this.config.imgwidth + '  Height: ' + this.config.imgheight);

    // Init some variables we'll be using in the process
    this.path = '';
    this.intensity = '';
    //this.gcodex = '';

    this.moveCount = 0; // Keep count of Gcode lines so we can optimise, lower = better
    this.skip = 0;
    this.dir = 1;
    //this.lastPosx = -1;
    this.megaPixel = 0;
    this.x = 0;
    //this.endPosx = 0;
    this.grayLevel = 0;
    //this.gridSize = 1;
    this.startTime = 0;

    this.rasterIntervalTimer = null;

    // GCODE Header
    // var useVariableSpeed = this.config.useVariableSpeed;

    G7startgcode = $('#startgcode').val();
    G7laseron = $('#laseron').val();
    G7laseroff = $('#laseroff').val();
    if ($('#lasermultiply').val()) {
      G7lasermultiply = $('#lasermultiply').val();
    } else {
      G7lasermultiply = 100;
      printLog('NB - generated with default value of S100 since you have not yet configured LaserWeb for your machine.  Click that settings button and configure the Max PWM S Value (and all the other settings please).... ', errorcolor)
    }
    G7homingseq = $('#homingseq').val();
    G7endgcode = $('#endgcode').val();

    this.result = [
        '; GCODE generated by Laserweb',
        // '; Firmware: {0}',
        '; Laser Max: {1}%',
        '; Laser Spot Size: {4}mm',
        '; Engraving Feedrate: {5}mm/s \n',
        //'G0 F{7}'
    ].join('\n').format(
        // this.config.firmware,
        this.config.minIntensity,
        this.config.maxIntensity,
        this.config.blackRate,
        this.config.whiteRate,
        this.config.spotSize1,
        this.config.feedRate,
	this.config.xOffset,
	this.config.yOffset);

    this.result += '; Start GCode\n'
    this.result += G7startgcode
    this.result += '\n';

    this.result += 'M649 S{0} B2 D0 R{1}\n'.format(this.config.maxIntensity, this.config.spotSize1);
    this.result += 'G0 X{0} Y{1} F{2}\nG1 F{3}\n'.format(this.config.xOffset, this.config.yOffset, this.config.rapidRate, this.config.feedRate);
}

G7Rasterizer.prototype.init = function() {
    this.startTime = Date.now();

    // Initialise
    project.clear();

    // Create a raster item using the image tag 'origImage'
    this.raster = new Raster('origImage');
    this.raster.visible = false;

    // Log it as a sanity check
    console.log('Not Constraining Laser power between {0}% and {1}%'.format(this.config.minIntensity, this.config.maxIntensity));
    console.log('Height: {0}px, Width: {1}px'.format(this.config.imgheight, this.config.imgwidth));
    console.log('Spot Size: {0}mm'.format(this.config.spotSize1));
    console.log('Raster Width: {0} Height: {1}'.format(this.raster.width, this.raster.height));
    console.log('G0: {0}mm/s, G1: {1}mm/s'.format(this.config.rapidRate, this.config.feedRate));
    console.log('Black speed: {0} Whitespeed: {1}'.format(this.config.blackRate, this.config.whiteRate));

    // As the web is asynchronous, we need to wait for the raster to load before we can perform any operation on its pixels.
    this.raster.on('load', this.onRasterLoaded.bind(this));
};


G7Rasterizer.prototype.rasterRow = function(y) {
    //console.log('[G7Rasterizer] rasterRow', y);
    var firstline=true;
    // In fast forward?
    if (typeof this.inFF === "undefined") this.inFF = false;
    if (this.inFF == true) { // Only second time
	this.result += 'G91\nG0 Y{0}\nG90\n'.format(2*this.config.spotSize1);
	this.inFF = false;
	return; // We are done with this line
    } else {
	// Check if the two folling lines can be fast forwarded
	if (y%2 == 0 && y < this.raster.height -2) {
	    var ImgData1 = this.raster.getImageData(0, this.raster.height - y - 1, this.raster.width, 1);
	    var ImgData2 = this.raster.getImageData(0, this.raster.height - (y+1) - 1, this.raster.width, 1);
	    var px1 = ImgData1.data;
	    var px2 = ImgData2.data;
//	    console.log(ii,px1[ii+0],px1[ii+1],px1[ii+2],px1[iii+0],px1[iii+1],px1[iii+2]);
	    this.inFF=false;
	    for (var i=0; i < this.raster.width; i++) {
		var ii = i*4;
		var clrsum = px1[ii] + px1[ii+1] + px1[ii+2] + px2[ii] + px2[ii+1] + px2[ii+2];
		var transpsum = px1[ii+3]+px2[ii+3];
		if ((clrsum == 0 && transpsum != 0) || (clrsum != 0)) {  // Color
		    //console.log('==>',ii,clrsum, transpsum, px1[ii+0],px1[ii+1],px1[ii+2],px1[ii+3],px2[ii+0],px2[ii+1],px2[ii+2],px2[ii+3]);
		    this.inFF = false;
		    break; // We do the line
		}
	    }
	    if (this.inFF) return;
	}
    }
    var ImgData = this.raster.getImageData(0, this.raster.height - y - 1, this.raster.width, 1);
    var pixels = ImgData.data;
    var G7dots;
    for (G7dots = 0; G7dots < Math.floor(this.raster.width / 51); G7dots++) {
	if (firstline) this.result += 'G7 ${0} L{1} D'.format(this.dir > 0 ? 1 : 0, 68);
	else           this.result += 'G7 L{0} D'.format(68);

	firstline = false;
	var buf = new Uint8Array(51);
	for (var ix = 0; ix < 51; ix++) {
	    var x = G7dots*51 + ix;
            if (this.dir < 0) x = this.raster.width - x - 1; // Backwards
	    var grayscale;
	    if (pixels[x*4+3] == 0) grayscale = 255; // Full transparency => white
            else  grayscale = pixels[x*4] * .3 + pixels[x*4+1] * .59 + pixels[x*4+2] * .11;
	    buf[ix] = Math.round(grayscale);
	}
	this.result += btoa(String.fromCharCode.apply(null, buf));
	this.result += '\n';
    }

    var rem = this.raster.width % 51;
    if (rem > 0) {  // Partial block (lenght < 51)
	if (firstline) this.result += 'G7 ${0} L{1} D'.format(this.dir > 0 ? 1 : 0, rem);
	else           this.result += 'G7 L{0} D'.format(rem);

	var buf = new Uint8Array(rem);
	for (var ix = 0; ix < rem; ix++) {
	    var x = G7dots*51 + ix;
            if (this.dir < 0) x = this.raster.width - x - 1; // Backwards
	    var grayscale;
	    if (pixels[x*4+3] == 0) grayscale = 255; // Full transparency => white
            else  grayscale = pixels[x*4] * .3 + pixels[x*4+1] * .59 + pixels[x*4+2] * .11;
	    buf[ix] = Math.round(grayscale);
	}
	this.result += btoa(String.fromCharCode.apply(null, buf));
	this.result += '\n\n';
    }
    this.dir = -this.dir; // Reverse direction for next row
};


G7Rasterizer.prototype.rasterInterval = function() {
    if (this.currentPosy < this.raster.height) {

        this.rasterRow(this.currentPosy);

        this.currentPosy++;
        var progress = Math.round((this.currentPosy / this.raster.height) * 100.0);
        //$('#rasterProgressShroud .progress-bar').width(progress + "%");
        $('#rasterProgressPerc').html(progress + "%");
        NProgress.set(progress / 100);
        //console.log('[Rasterizer] ', progress, '% done');
    } else {
        this.onFinish();
        //var rasterSendToLaserButton = document.getElementById("rasterWidgetSendRasterToLaser");
        //if (rasterSendToLaserButton.style.display == "none") { // Raster Mode
        NProgress.done();
        NProgress.remove();
        //$('#rasterparams').hide();
        //$('#rasterwidget').modal('hide');
        // } else {  // Calibration Mode
        $('#rasterparams').show();
        $('#rasterProgressShroud').hide();
        //   $('.progress').removeClass('active');
        // 	$('#rasterProgressShroud .progress-bar').width(0);
        // }
        window.clearInterval(this.rasterIntervalTimer);
    }
};

G7Rasterizer.prototype.onRasterLoaded = function() {
    //console.log('[Rasterizer] onRasterLoaded');
    //console.log('[Rasterizer] onRasterLoaded');
    var rasterSendToLaserButton = document.getElementById("rasterWidgetSendRasterToLaser");
    //if (rasterSendToLaserButton.style.display == "none") {  // Raster Mode
    $('#rasterparams').hide();
    $('#rasterProgressShroud').show();
    $('.progress').removeClass('active');
    $('#rasterProgressShroud .progress-bar').width(0);
    // } else {  // Calibration Mode
    //   $('#rasterparams').hide();
    //   $('#rasterProgressShroud').show();
    //   $('.progress').removeClass('active');
    // 	$('#rasterProgressShroud .progress-bar').width(0);
    // }

    // Iterate through the Pixels asynchronously
    this.currentPosy = 0;
    this.rasterIntervalTimer = window.setInterval(this.rasterInterval.bind(this), 10);
};

G7Rasterizer.prototype.onFinish = function() {
    // if (firmware.indexOf('Lasaur') == 0) {
    //   this.result += 'M81\n'; // Air Assist off
    // }

    // Populate the GCode textarea
    document.getElementById('gcodepreview').value = this.result;
    console.log('Optimized by number of line: ', this.skip);

    // Some Post-job Stats and Cleanup
    console.log('Number of GCode Moves: ', this.moveCount);
    var pixeltotal = this.raster.width * this.raster.height;
    console.log('Pixels: {0} done, of {1}'.format(this.megaPixel, pixeltotal));

    console.timeEnd("Process Raster");
    var currentTime = Date.now();
    var elapsed = (currentTime - this.startTime);
    $('#console')
        .append('<p class="pf" style="color: #009900;"><b>Raster completed in {0}ms</b></p>'.format(elapsed))
        .scrollTop($("#console")[0].scrollHeight - $("#console").height());

    if (this.config.completed) {
        this.config.completed();
    }
};
