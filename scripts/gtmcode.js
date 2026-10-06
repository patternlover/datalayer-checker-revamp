function injectCode(codeToPush, tag) {
  const tagName = document.getElementsByTagName(tag)[0];
  const Script = document.createElement("script");
  Script.textContent = codeToPush;
  if (tag === "head") {
    try {
      tagName.prepend(Script);
    } catch (error) {
      console.log(error);
    }
  }
  if (tag === "body") {
    try {
      tagName.appendChild(Script);
    } catch (error) {
      console.log(error);
    }
  }
}

const listnerCode = `window.addEventListener("message", (event) => {
  
  if(event.data && event.data.action === 'setGTMCode'){
    injectCode(event.data.code, event.data.position);
  }
  var dataLayerData = event.data;
  if(dataLayerData && dataLayerData.event_source === 'custom_pixel_dataLayer_replace'){
  window.dataLayer = window.dataLayer || [];
  window.dataLayer = dataLayerData.data;
  }
  
  if(dataLayerData && dataLayerData.event_source === 'customPixel'){
  if(dataLayerData.data[0].event === 'gtm.dom' || dataLayerData.data[0].event === 'gtm.load'){
   return;
  }
  window.dataLayer.push(dataLayerData.data[0]);
  }
});`;

injectCode(listnerCode, "head");
