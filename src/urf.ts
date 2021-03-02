import { PNG } from 'pngjs';

type Margins = {
    top: number;
    bottom: number;
    left: number;
    right: number;
};
type EncodeConfig = {
    width: number;
    height: number;
    greyScale?: boolean;
    turn?: boolean;
    dpi?: number;
    margin?: Partial<Margins>;
};

export default class Urf {
    margin: Margins = {
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
    };

    turn = false;

    width = 0;

    height = 0;

    greyscale = true;

    dpi = 300;

    Encode(
        imgData: number[],
        config: EncodeConfig,
        callback: (buffer: Buffer) => void,
    ): void {
        this.margin = {
            ...this.margin,
            ...config.margin,
        };

        const { width } = config;
        const { height } = config;

        const bytesPerPixel = imgData.length / (config.width * config.height);

        const blob: Buffer[] = [];
        blob.push(Buffer.from('554e495241535400', 'hex')); // UNIRAST
        blob.push(Buffer.from('00000001', 'hex')); // Some Header
        //

        let greyscale = false;
        if (config.greyScale || bytesPerPixel <= 2) {
            greyscale = true;
            blob.push(Buffer.from('08', 'hex'));
            blob.push(Buffer.from('00', 'hex'));
        } else {
            blob.push(Buffer.from('18', 'hex'));
            blob.push(Buffer.from('01', 'hex'));
        }

        blob.push(Buffer.from('00', 'hex')); // DUPLEX_MODE
        blob.push(Buffer.from('04', 'hex')); // QUALITY
        blob.push(Buffer.from('0000000100000000', 'hex')); // UNKNOWN

        let newHeight = height;
        let newWidth = width;
        const emptyColor = greyscale ? 'ff' : 'ffffff';

        if (config.turn) {
            newHeight = width;
            newWidth = height;
        }

        function writeEmptyLines(count: number) {
            /* eslint-disable no-param-reassign */
            while (count) {
                if (count > 256) {
                    blob.push(Buffer.from('ff80', 'hex'));
                    count -= 256;
                } else {
                    const last = Buffer.alloc(1);
                    last.writeUIntBE(count - 1, 0, 1);
                    blob.push(last);
                    blob.push(Buffer.from('80', 'hex'));
                    count = 0;
                }
            }
        }

        function writePixelRepeatedly(count: number, pixel: Buffer) {
            while (count > 0) {
                if (count > 128) {
                    blob.push(Buffer.from('7f', 'hex'));
                    count -= 128;
                } else {
                    const last = Buffer.alloc(1);
                    last.writeUIntBE(count - 1, 0, 1);
                    blob.push(last);
                    count = 0;
                }

                blob.push(pixel);
            }
        }

        function writeEmptyPixel(count: number) {
            writePixelRepeatedly(count, Buffer.from(emptyColor, 'hex'));
        }

        const widthBlob = Buffer.alloc(4);
        widthBlob.writeUIntBE(
            newWidth + this.margin.left + this.margin.right,
            0,
            4,
        );
        blob.push(widthBlob);

        const heightBlob = Buffer.alloc(4);
        heightBlob.writeUIntBE(
            newHeight + this.margin.top + this.margin.bottom,
            0,
            4,
        );
        blob.push(heightBlob);

        const dpi = Buffer.alloc(4);
        if (config.dpi) {
            dpi.writeUIntBE(config.dpi, 0, 4);
        } else {
            dpi.writeUIntBE(300, 0, 4);
        }
        blob.push(dpi);

        blob.push(Buffer.from('0000000000000000', 'hex')); // Seems neccessary

        writeEmptyLines(this.margin.top);

        let lastColorValue = '';
        let repeatedCounter = 0;

        const flush = () => {
            if (lastColorValue !== '') {
                const pixel = Buffer.from(lastColorValue, 'hex');
                writePixelRepeatedly(repeatedCounter, pixel);

                // reset
                lastColorValue = '';
                repeatedCounter = 0;
            }
        };

        for (let y = 0; y < newHeight; y++) {
            blob.push(Buffer.from('00', 'hex')); // line repeat code

            // writeEmptyPixel(this.margin.left);
            repeatedCounter = this.margin.left;
            lastColorValue = emptyColor;

            for (let x = 0; x < newWidth; x++) {
                const pixel = Buffer.alloc(greyscale ? 1 : 3);
                let index: number;

                if (config.turn) {
                    index = Math.floor(
                        (newHeight * (newWidth - 1 - x) + y) * bytesPerPixel,
                    );
                } else {
                    index = Math.floor((newWidth * y + x) * bytesPerPixel);
                }

                // grey = 0,299 × red + 0,587 × green + 0,114 × blue
                if (greyscale) {
                    let greyValue = imgData[index];

                    if (bytesPerPixel > 2) {
                        greyValue =
                            0.299 * greyValue +
                            0.587 * imgData[index + 1] +
                            0.114 * imgData[index + 2];
                    }
                    if (bytesPerPixel === 2 || bytesPerPixel === 4) {
                        greyValue =
                            (greyValue * imgData[index + 3]) / 255 +
                            255 -
                            imgData[index + 3];
                    }
                    pixel.writeUIntBE(greyValue, 0, 1);
                } else {
                    for (let i = 0; i < 3; i++) {
                        let colorValue = imgData[index + i];

                        if (bytesPerPixel === 4) {
                            colorValue =
                                (colorValue * imgData[index + 3]) / 255 +
                                (255 - imgData[index + 3]);
                        }

                        pixel.writeUIntBE(colorValue, i, 1);
                    }
                }

                const currentColorValue = pixel.toString('hex');
                if (lastColorValue === currentColorValue) {
                    repeatedCounter = (repeatedCounter || 1) + 1;
                } else {
                    flush();
                    lastColorValue = currentColorValue;
                    repeatedCounter = 1;
                }
            }

            if (lastColorValue !== emptyColor) {
                flush();
            }

            writeEmptyPixel(this.margin.right + repeatedCounter);
        }

        writeEmptyLines(this.margin.bottom);

        callback(Buffer.concat(blob));
    }

    // eslint-disable-next-line class-methods-use-this
    Decode(buf: Buffer, callback: (png: PNG) => void): void {
        let code: number;
        let k: number;
        let y: number;
        let x: number;
        const config = {
            bitPerPixel: buf.readUInt8(12),
            colorValues: buf.readUInt8(13) === 0 ? 1 : 3,
            width: buf.readUInt32BE(24),
            height: buf.readUInt32BE(28),
            duplex: buf.readUInt8(14),
            quality: buf.readUInt8(15),
            dpi: buf.readUInt32BE(32),
        };
        const png = new PNG({ width: config.width, height: config.height });

        function copySinglePixel(
            pixel: number[],
            pixelX: number,
            pixelY: number,
        ) {
            const idx = (config.width * pixelY + pixelX) << 2;
            if (pixel.length === 1) {
                png.data[idx] = pixel[0];
                png.data[idx + 1] = pixel[0];
                png.data[idx + 2] = pixel[0];
                png.data[idx + 3] = 0xff;
            } else {
                png.data[idx] = pixel[0];
                png.data[idx + 1] = pixel[1];
                png.data[idx + 2] = pixel[2];
                png.data[idx + 3] = 0xff;
            }
        }

        function fillRestOfLineEmpty() {
            for (let i = x; i < config.width; i++) {
                copySinglePixel([0xff], i, y);
            }
            x = config.width;
        }

        function copySinglePixelRepeatedly() {
            const pixel = [];
            for (let col = 0; col < config.colorValues; col++) {
                pixel.push(buf.readUInt8(k++));
            }
            for (let l = 0; l <= code; l++) {
                copySinglePixel(pixel, x, y);
                x++;
            }
        }

        function copyMultiplePixels() {
            for (let pix = 0; pix <= code * -1; pix++) {
                const pixel = [];
                for (let col = 0; col < config.colorValues; col++) {
                    pixel.push(buf.readUInt8(k++));
                }
                copySinglePixel(pixel, x, y);
                x++;
            }
        }

        function checkEndOfLine() {
            if (x >= config.width) {
                x = 0;
                y++;
                return true;
            }
            return false;
        }

        x = 0;
        y = 0;
        k = 44; // firstDataByte

        while (k < buf.length - 1) {
            const lineRepeatNumber = buf.readUInt8(k++);
            const LineToRepeat = k;
            let endOfLine = false;

            for (let lr = 0; lr <= lineRepeatNumber; lr++) {
                k = LineToRepeat;
                endOfLine = false;

                while (!endOfLine) {
                    code = Number(buf.readInt8(k++));
                    if (code === -128) {
                        fillRestOfLineEmpty();
                    } else if (code >= 0) {
                        copySinglePixelRepeatedly();
                    } else if (code < 0) {
                        copyMultiplePixels();
                    }
                    endOfLine = checkEndOfLine();
                }
            }
        }

        callback(png);
    }
}
