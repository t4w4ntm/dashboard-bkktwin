using System.Collections;
using UnityEngine;
using UnityEngine.Networking;

/// <summary>
/// ไฟล์ทดสอบการเชื่อมต่อ WAQI และ ThingSpeak API
/// วิธีใช้: แนบ script นี้กับ GameObject ว่างๆ ใน scene แล้วกด Play
/// ดูผลลัพธ์ใน Console
/// </summary>
public class APITester : MonoBehaviour
{
    [Header("API Configuration")]
    [SerializeField] private string thingSpeakURL = "https://api.thingspeak.com/channels/3027679/feeds/last.json?api_key=4M306YRQZ87072KV";
    [SerializeField] private string waqiToken = "75a1a645825e299fdd790d95235ca5192ef92d87";
    [SerializeField] private string waqiStation = "bangkok";
    
    private void Start()
    {
        Debug.Log("=== API Integration Test Started ===");
        StartCoroutine(RunTests());
    }
    
    private IEnumerator RunTests()
    {
        Debug.Log("\n--- Test 1: ThingSpeak API ---");
        yield return TestThingSpeak();
        
        yield return new WaitForSeconds(1f);
        
        Debug.Log("\n--- Test 2: WAQI API ---");
        yield return TestWAQI();
        
        yield return new WaitForSeconds(1f);
        
        Debug.Log("\n--- Test 3: Calculate Average ---");
        yield return TestAverage();
        
        Debug.Log("\n=== All Tests Completed ===");
    }
    
    private IEnumerator TestThingSpeak()
    {
        using (UnityWebRequest request = UnityWebRequest.Get(thingSpeakURL))
        {
            yield return request.SendWebRequest();
            
            if (request.result == UnityWebRequest.Result.Success)
            {
                Debug.Log("✅ ThingSpeak API - SUCCESS");
                Debug.Log($"Response: {request.downloadHandler.text}");
                
                try
                {
                    ThingSpeakData data = JsonUtility.FromJson<ThingSpeakData>(request.downloadHandler.text);
                    Debug.Log($"Field 1 (Klong San): {data.field1}");
                    Debug.Log($"Field 2 (Thon Buri): {data.field2}");
                    Debug.Log($"Field 3 (Bang Rak): {data.field3}");
                    Debug.Log($"Created At: {data.created_at}");
                }
                catch (System.Exception e)
                {
                    Debug.LogError($"❌ Error parsing JSON: {e.Message}");
                }
            }
            else
            {
                Debug.LogError($"❌ ThingSpeak API - FAILED");
                Debug.LogError($"Error: {request.error}");
            }
        }
    }
    
    private IEnumerator TestWAQI()
    {
        string waqiURL = $"https://api.waqi.info/feed/{waqiStation}/?token={waqiToken}";
        
        using (UnityWebRequest request = UnityWebRequest.Get(waqiURL))
        {
            yield return request.SendWebRequest();
            
            if (request.result == UnityWebRequest.Result.Success)
            {
                Debug.Log("✅ WAQI API - SUCCESS");
                Debug.Log($"Response: {request.downloadHandler.text}");
                
                try
                {
                    WAQIData data = JsonUtility.FromJson<WAQIData>(request.downloadHandler.text);
                    Debug.Log($"Status: {data.status}");
                    
                    if (data.status == "ok" && data.data != null)
                    {
                        Debug.Log($"AQI: {data.data.aqi}");
                        
                        if (data.data.iaqi != null && data.data.iaqi.pm25 != null)
                        {
                            Debug.Log($"PM2.5: {data.data.iaqi.pm25.v} µg/m³");
                        }
                        else
                        {
                            Debug.LogWarning("⚠️ PM2.5 data not available in response");
                        }
                    }
                }
                catch (System.Exception e)
                {
                    Debug.LogError($"❌ Error parsing JSON: {e.Message}");
                }
            }
            else
            {
                Debug.LogError($"❌ WAQI API - FAILED");
                Debug.LogError($"Error: {request.error}");
            }
        }
    }
    
    private IEnumerator TestAverage()
    {
        float tsPM25 = -1f;
        float waqiPM25 = -1f;
        
        // Fetch ThingSpeak
        using (UnityWebRequest request = UnityWebRequest.Get(thingSpeakURL))
        {
            yield return request.SendWebRequest();
            
            if (request.result == UnityWebRequest.Result.Success)
            {
                try
                {
                    ThingSpeakData data = JsonUtility.FromJson<ThingSpeakData>(request.downloadHandler.text);
                    if (float.TryParse(data.field1, out float value))
                    {
                        tsPM25 = value;
                    }
                }
                catch (System.Exception e)
                {
                    Debug.LogError($"ThingSpeak parse error: {e.Message}");
                }
            }
        }
        
        // Fetch WAQI
        string waqiURL = $"https://api.waqi.info/feed/{waqiStation}/?token={waqiToken}";
        using (UnityWebRequest request = UnityWebRequest.Get(waqiURL))
        {
            yield return request.SendWebRequest();
            
            if (request.result == UnityWebRequest.Result.Success)
            {
                try
                {
                    WAQIData data = JsonUtility.FromJson<WAQIData>(request.downloadHandler.text);
                    if (data.status == "ok" && data.data != null && data.data.iaqi != null && data.data.iaqi.pm25 != null)
                    {
                        waqiPM25 = data.data.iaqi.pm25.v;
                    }
                }
                catch (System.Exception e)
                {
                    Debug.LogError($"WAQI parse error: {e.Message}");
                }
            }
        }
        
        // Calculate Average
        Debug.Log("--- Calculation Results ---");
        Debug.Log($"ThingSpeak PM2.5: {(tsPM25 >= 0 ? tsPM25.ToString("F1") : "N/A")} µg/m³");
        Debug.Log($"WAQI PM2.5: {(waqiPM25 >= 0 ? waqiPM25.ToString("F1") : "N/A")} µg/m³");
        
        if (tsPM25 >= 0 && waqiPM25 >= 0)
        {
            float average = (tsPM25 + waqiPM25) / 2f;
            Debug.Log($"✅ Average PM2.5: {average:F1} µg/m³");
            Debug.Log($"Formula: ({tsPM25:F1} + {waqiPM25:F1}) / 2 = {average:F1}");
        }
        else if (tsPM25 >= 0)
        {
            Debug.Log($"⚠️ Using ThingSpeak only: {tsPM25:F1} µg/m³");
        }
        else if (waqiPM25 >= 0)
        {
            Debug.Log($"⚠️ Using WAQI only: {waqiPM25:F1} µg/m³");
        }
        else
        {
            Debug.LogError("❌ No data available from either source");
        }
    }
}
