// Porting di Omnibug (MIT, https://github.com/MisterPhilip/omnibug), src/providers/MicrosoftClarity.js.
// Il dizionario dei parametri resta quello di Omnibug: qui cambia solo la forma (modulo ES) e il
// consumo (lib/providers/index.js). Licenza e provenienza in lib/providers/README.md.
/**
 * Microsoft Clarity
 * https://clarity.microsoft.com/
 *
 * @class
 * @extends BaseProvider
 */
import BaseProvider from "./base.js";

export default class MicrosoftClarityProvider extends BaseProvider {
    constructor() {
        super();
        this._key = "MSCLARITY";
        this._pattern = /clarity\.ms\/tag\//;
        this._name = "Microsoft Clarity";
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
            "requestType": "omnibug_requestType"
        };
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
                "value": url.pathname.split("/").pop(),
                "group": "general"
            },
            {
                "key": "omnibug_requestType",
                "value": "Library Load",
                "hidden": "true"
            }
        ];
    }
}
