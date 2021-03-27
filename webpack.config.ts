import { Configuration } from 'webpack';
import { resolve } from 'path';

const isProductionBuild: boolean = process.env.NODE_ENV === 'production';

const config: Configuration = {
    devtool: 'source-map',
    target: 'node',
    entry: {
        main: resolve(__dirname, "src", "extension.ts")
    },
    module: {
        rules: [
            {
                include: resolve(__dirname,"src"),
                test: /\.ts$/,
                loader: 'ts-loader'
            }
        ]
    },
    externals: {
        vscode: 'commonjs vscode'
    },
    resolve: {
        extensions: ['.ts', '.js']
    },
    output: {
        path: resolve(__dirname, "out"),
        filename: 'extension.js',
        libraryTarget: 'commonjs2'
    },
    mode: 'development'
};

export default config;