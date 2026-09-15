/** Open the current actor's squad cell, as the player does. */
exports.openCombatCommands=async(run,wait)=>{
 await wait(`Boolean(document.querySelector('[data-command-trigger=true]:enabled'))`);
 if(!await run(`Boolean(document.querySelector('.combat-command-overlay'))`))await run(`document.querySelector('[data-command-trigger=true]').click()`);
 await wait(`document.querySelector('.combat-command-overlay')?.dataset.commandReady==='true'`);
};
