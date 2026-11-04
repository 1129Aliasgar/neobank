/**
 * Route registration. Importing a controller module registers its decorators
 * with inversify-express-utils, so every controller must be listed here.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import "./auth.controller.js";
import "./business.controller.js";
import "./webhook.controller.js";
import "./ledger.controller.js";
import "./operations.controller.js";
import "./card.controller.js";
