const fs = require('fs');

const Urf = require('.').default;

const urf = new Urf();

const picture = [255, 255, 255, 0, 0, 0, 255, 255, 255]; // RGB or greyscale pixel-array

const config = {
    width: 3, // width of picture
    height: 3, // height of picture
    greyScale: true, // Convert to greyscale, optional
    margin: {
        top: 5,
        bottom: 5,
        left: 5,
        right: 5,
    },
};

urf.Encode(picture, config, function (buffer) {
    urf.Decode(buffer, function (png) {
        // giving back an new PNG (see pngjs)
        png.pack()
            .pipe(fs.createWriteStream('newfile.png'))
            .on('finish', function () {
                console.log('Written to disk');
            });
    });
});
