import tl = require("azure-pipelines-task-lib/task");
import path = require("path");
import fs = require("fs");
import Q = require("q");
import { IExecOptions } from "azure-pipelines-task-lib/toolrunner";

tl.setResourcePath(path.join(__dirname, "task.json"));
console.log("Setting resource path to...", path.join(__dirname, "task.json"));

//Get user input
const cfEndpoint = tl.getInput("cfEndpoint", true);
const cfEndpointUrl = tl.getEndpointUrl(cfEndpoint, false);
const cfEndpointAuth = tl.getEndpointAuthorization(cfEndpoint, false);
const workingDir = tl.getInput("workingDirectory", true);

//get the install location of cf
//TODO: check if we need to to which cf7 for latest cli version
let cfPath = tl.which("cf7");
if (tl.filePathSupplied("cfToolLocation")) {
  tl.debug("Using supplied tool location");
  cfPath = tl.getPathInput("cfToolLocation");
}

function getOptions() {
  const CFHOMEKEY = "CF_HOME";
  var options = <IExecOptions>{};
  options.env = process.env;

  if (!(CFHOMEKEY in options.env)) {
    const tempDir = tl.getVariable("Agent.TempDirectory");
    // overriding config dir so that different agents on the same host can run. https://docs.cloudfoundry.org/cf-cli/cf-help.html
    options.env["CF_HOME"] = path.join(tempDir, "cfCLI");
    console.info(
      "overriding config dir so that different agents on the same host can run. https://docs.cloudfoundry.org/cf-cli/cf-help.html"
    );
  }

  return options;
}

function loginToCF() {
  return Q.fcall(() => {
    var cfLogin = tl.tool(cfPath);
    cfLogin.arg("login");
    cfLogin.arg("-a");
    cfLogin.arg(cfEndpointUrl);
    cfLogin.arg("-u");
    cfLogin.arg(cfEndpointAuth["parameters"]["username"]);
    cfLogin.arg("-p");
    cfLogin.arg(cfEndpointAuth["parameters"]["password"]);
    if (tl.getBoolInput("oneTimePassword")) {
      cfLogin.arg("--sso-passcode");
      cfLogin.arg(tl.getInput("ssoPasscode"));
    }
    if (tl.getBoolInput("skipSSLValidation")) {
      cfLogin.arg("--skip-ssl-validation");
    }
    if (tl.getInput("org")) {
      cfLogin.arg("-o");
      cfLogin.arg(tl.getInput("org"));
    }
    if (tl.getInput("space")) {
      cfLogin.arg("-s");
      cfLogin.arg(tl.getInput("space"));
    }

    tl.debug("Login to connect to cf instance");
    return cfLogin.exec(getOptions());
  });
}

//create a service using cf CLI create-user-provided-service
function createService(createServiceArgs: string) {
  return Q.fcall(() => {
    if (createServiceArgs && createServiceArgs.trim() != "") {
      //cf cups = create-user-provided-service
      var cfCups = tl.tool(cfPath);
      cfCups.arg("create-user-provided-service");
      cfCups.line(createServiceArgs);
      return cfCups.exec(getOptions());
    } else {
      return Q(0);
    }
  });
}

//create multiple services based on user input
function createServices() {
  return Q.fcall(() => {
    var serviceDetails: string[] = tl.getDelimitedInput("createServiceArgs", "\n", false);
    if (tl.getBoolInput("createServices") && serviceDetails && serviceDetails.length > 0) {
      var result = Q({});
      serviceDetails.forEach((fn) => {
        result = result.then(() => {
          return createService(fn);
        });
      });
      return result;
    } else {
      tl.debug("User did not choose to create a service or provide any service details.");
      return Q(0);
    }
  });
}

//update a service using cf CLI create-user-provided-service
function updateService(updateServiceArgs: string) {
  return Q.fcall(() => {
    if (updateServiceArgs && updateServiceArgs.trim() != "") {
      //cf uups = update-user-provided-service
      var cfUups = tl.tool(cfPath);
      cfUups.arg("update-user-provided-service");
      cfUups.line(updateServiceArgs);
      return cfUups.exec(getOptions());
    } else {
      return Q(0);
    }
  });
}

//update multiple services based on user input
function updateServices() {
  return Q.fcall(() => {
    var serviceDetails: string[] = tl.getDelimitedInput("updateServiceArgs", "\n", false);
    if (tl.getBoolInput("updateServices") && serviceDetails && serviceDetails.length > 0) {
      var result = Q({});
      serviceDetails.forEach((fn) => {
        result = result.then(() => {
          return updateService(fn);
        });
      });
      return result;
    } else {
      tl.debug("User did not choose to update a service or provide any service details.");
      return Q(0);
    }
  });
}

//push app using cf CLI push
function pushAppToCF() {
  return Q.fcall(() => {
    tl.cd(workingDir);
    var cfPush = tl.tool(cfPath);
    cfPush.arg("push");

    if (tl.getBoolInput("rollingStrategy")) {
      cfPush.arg("--strategy");
      cfPush.arg("rolling");
    }
    if (tl.getInput("deploymentOptions") == "manifest") {
      if (tl.getInput("cfManifest", true)) {
        cfPush.arg("-f");
        cfPush.arg(tl.getInput("cfManifest"));
      }
    } else if (tl.getInput("deploymentOptions") == "manual") {
      //set the command line arguments for all the options specified in the UI
      if (tl.getInput("name")) {
        cfPush.arg(tl.getInput("name"));
      }

      if (tl.getInput("instances")) {
        cfPush.arg("-i");
        cfPush.arg(tl.getInput("instances"));
      }

      if (tl.getInput("memoryLimit")) {
        cfPush.arg("-m");
        cfPush.arg(tl.getInput("memoryLimit"));
      }

      if (tl.getInput("startCommand")) {
        cfPush.arg("-c");
        cfPush.arg(tl.getInput("startCommand"));
      }

      let buildPackOption: string = tl.getInput("buildPackOptions");
      if (buildPackOption === "custom") {
        cfPush.arg("-b");
        cfPush.arg(tl.getInput("buildPackCustom", true));
      } else if (buildPackOption === "builtin") {
        cfPush.arg("-b");
        cfPush.arg("default");
      }

      if (tl.getBoolInput("useRoute")) {
        if (tl.getInput("domain")) {
          cfPush.arg("-d");
          cfPush.arg(tl.getInput("domain"));
        }

        if (tl.getInput("host")) {
          cfPush.arg("--hostname");
          cfPush.arg(tl.getInput("host"));
        }
      } else {
        cfPush.arg("--no-route");
      }

      if (!tl.getBoolInput("startOnDeploy", false)) {
        cfPush.arg("--no-start");
      }
    }

    //any additional arguments to pass to cf push
    if (tl.getInput("additionalDeployArgs")) {
      cfPush.line(tl.getInput("additionalDeployArgs"));
    }

    return cfPush.exec(getOptions());
  });
}

//restage an app after binding services using cf CLI
function restageApp(appName: string) {
  return Q.fcall(() => {
    var cfRestage = tl.tool(cfPath);
    cfRestage.arg("restage");
    cfRestage.arg(appName);
    return cfRestage.exec(getOptions());
  });
}

//bind one service to an app using cf CLI
function bindServiceToApp(appName: string, service: string) {
  return Q.fcall(() => {
    if (appName && service && service.trim() != "") {
      var cfBindService = tl.tool(cfPath);
      cfBindService.arg("bind-service");
      cfBindService.arg(appName);
      cfBindService.line(service);
      return cfBindService.exec(getOptions());
    } else {
      return Q(0);
    }
  });
}

//bind multiple serivces to an app based on user input
function bindServicesToApp() {
  return Q.fcall(() => {
    var services: string[] = tl.getDelimitedInput("bindServiceArgs", "\n", false);
    if (tl.getBoolInput("bindServices") && services && services.length > 0) {
      //get the application name from services group or deployment options group
      var appName = tl.getInput("appName", true);
      var result = Q({});
      services.forEach((fn) => {
        result = result.then(() => {
          return bindServiceToApp(appName, fn);
        });
      });
      result
        .then(function (code) {
          tl.debug(
            "Successfully bound all services to the application. Restaging the application for changes to take effect."
          );
          return restageApp(appName);
        })
        .fail(function (err) {
          tl.error(err);
          tl.setResult(tl.TaskResult.Failed, tl.loc("BindServicesFailed"));
          return Q.reject(err);
        });
    } else {
      tl.debug(
        "User did not choose to bind services or specify any services to bind to the application."
      );
      return Q(0);
    }
  });
}

if (!cfPath) {
  //tool location for cf CLI was not specified, show error if cf CLI is not in the PATH
  tl.setResult(tl.TaskResult.Failed, tl.loc("CLINotFound"));
} else if (!fs.existsSync(cfPath)) {
  tl.setResult(tl.TaskResult.Failed, tl.loc("CLINotFoundInPath", cfPath));
} else {
  //The main task logic to push an app to Cloud Foundry
  loginToCF()
    .then(function (code) {
      tl.debug("cf login succeeded, create services if applicable.");
      createServices()
        .then(function (code) {
          tl.debug("Finished creating services if applicable, update services.");
          updateServices()
            .then(function (code) {
              tl.debug("Finished updatiang services if applicable, push app using cf CLI.");
              pushAppToCF()
                .then(function (code) {
                  tl.debug("Successfully pushed app, now bind to existing services if applicable.");
                  bindServicesToApp().fail(function (err) {
                    tl.error(err);
                    tl.setResult(tl.TaskResult.Failed, tl.loc("BindServicesFailed"));
                  });
                })
                .fail(function (err) {
                  tl.error(err);
                  tl.setResult(tl.TaskResult.Failed, tl.loc("PushFailed"));
                });
            })
            .fail(function (err) {
              tl.error(err);
              tl.setResult(tl.TaskResult.Failed, tl.loc("UpdateServiceFailed"));
            });
        })
        .fail(function (err) {
          tl.error(err);
          tl.setResult(tl.TaskResult.Failed, tl.loc("CreateServiceFailed"));
        });
    })
    .fail(function (err) {
      tl.error(err);
      tl.setResult(tl.TaskResult.Failed, tl.loc("EndPointCredentials"));
    });
}
