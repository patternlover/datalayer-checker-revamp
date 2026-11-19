// Porting di Omnibug (MIT, https://github.com/MisterPhilip/omnibug), src/providers/Hotjar.js.
// Il dizionario dei parametri resta quello di Omnibug: qui cambia solo la forma (modulo ES) e il
// consumo (lib/providers/index.js). Licenza e provenienza in lib/providers/README.md.
/**
 * Hotjar
 * https://www.hotjar.com/
 *
 * @class
 * @extends BaseProvider
 */
import BaseProvider from "./base.js";

export default class HotjarProvider extends BaseProvider {
    constructor() {
        super();
        this._key = "HOTJAR";
        this._pattern = /hotjar.com\/c\/hotjar-\d+\.js/;
        this._name = "Hotjar";
        this._type = "replay";
        this._keywords = ["heat map", "heatmap", "session record", "click"];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping() {
        return {
            "account":     "account",
            "requestType":  "_requestType",
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [
            {
                "key": "general",
                "name": "General"
            }
        ];
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {void|Array}
     */
    handleCustom(url, params) {
        return [
            {
                "key":   "account",
                "field": "Account ID",
                "value": url.pathname.match(/hotjar-(\d+)\.js/)[1],
                "group": "general"
            },
            {
                "key": "_requestType",
                "value": "Library Load",
                "hidden": true,
            }
        ];
    }
}
